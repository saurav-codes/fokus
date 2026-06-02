import json
import logging
from datetime import datetime
from functools import wraps
from time import monotonic

import redis.asyncio as aioredis
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from django.shortcuts import get_object_or_404

from .business_logic import selectors
from .business_logic.services import AsyncTimerService
from .models import FocusSession

logger = logging.getLogger(__name__)
CLIENT_BROADCAST_MIN_INTERVAL_SECONDS = 5


def async_session_owner_only(func):
    """
    Decorator to check if the user is the session owner
    & if not, send an error message to the client
    because only session owner can perform this action
    """

    @wraps(func)
    async def wrapper(self, *args, **kwargs):
        user = self.scope["user"]

        @database_sync_to_async
        def get_session_owner():
            session = FocusSession.objects.get(session_id=self.session_id)
            return session.owner

        session_owner = await get_session_owner()

        if user != session_owner:
            logger.warning(
                "Unauthorized session action: session_id=%s user_id=%s",
                self.session_id,
                getattr(user, "id", None),
            )
            await self.send(text_data=json.dumps({"error": "You are not authorized to perform this action."}))
            return
        return await func(self, *args, **kwargs)

    return wrapper


class FocusSessionConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        self.session_id = self.scope["url_route"]["kwargs"]["session_id"]
        self.session_group_name = f"focus_session_{self.session_id}"
        self.redis_client = await aioredis.from_url(settings.REDIS_URL, **settings.REDIS_CLIENT_KWARGS)
        self.session = await database_sync_to_async(get_object_or_404)(
            FocusSession.objects.select_related("owner", "current_cycle"),
            session_id=self.session_id,
        )
        self.timer_service = AsyncTimerService(session=self.session, user=self.user)
        self.last_client_broadcast_at = 0.0

        await self.channel_layer.group_add(self.session_group_name, self.channel_name)  # type: ignore
        await self.accept()
        logger.info("Websocket connected: session_id=%s user_id=%s", self.session_id, getattr(self.user, "id", None))
        await self.send_timer_update_to_all_clients()
        if self.user == await self.timer_service._get_session_owner():
            await self.timer_service.schedule_next_cycle_change(redis_client=self.redis_client)
        await self.update_session_followers_list_to_all_clients()

    async def disconnect(self, close_code):
        if not hasattr(self, "timer_service"):
            return
        # websocket is disconnect for whatever reasons
        # so we will save the session
        if self.user == await self.timer_service._get_session_owner():
            # only owner can save the session
            # because other are just followers
            await self.timer_service._save_last_focus_period_of_current_session()
            session = await self.timer_service._refresh_session()
            if session.timer_state == FocusSession.TIMER_RUNNING:
                # since the timer is running, we will create a new focus period
                # which will be the last focus period of the session
                await self.timer_service._create_new_focus_period()
                logger.info(
                    "Created focus period on disconnect: session_id=%s user_id=%s",
                    self.session_id,
                    getattr(self.user, "id", None),
                )
        await self.channel_layer.group_discard(self.session_group_name, self.channel_name)  # type: ignore
        if hasattr(self, "redis_client"):
            await self.redis_client.aclose()
        logger.info(
            "Websocket disconnected: session_id=%s user_id=%s close_code=%s",
            self.session_id,
            getattr(self.user, "id", None),
            close_code,
        )

    async def receive(self, text_data):
        """
        Receive message from the client.
        """
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({"error": "Invalid websocket message."}))
            return
        if not isinstance(data, dict):
            await self.send(text_data=json.dumps({"error": "Invalid websocket message."}))
            return
        action = data.get("action")
        if action == "toggle_timer":
            await self.toggle_timer()
        elif action == "transition_to_next_cycle":
            await self.transition_to_next_cycle()
        elif action == "stop_timer":
            await self.stop_timer()
        elif action == "followers_update":
            logger.info(
                "Updating followers list: session_id=%s user_id=%s",
                self.session_id,
                getattr(self.user, "id", None),
            )
            await self.send_throttled_client_broadcasts(followers=True)
        elif action == "sync_inactive_timer":
            logger.info(
                "Syncing inactive timer: session_id=%s user_id=%s",
                self.session_id,
                getattr(self.user, "id", None),
            )
            await self.send_throttled_client_broadcasts(timer=True, will_finish_at=True)
        elif action == "join_session":
            logger.info(
                "Joining focus session: session_id=%s user_id=%s",
                self.session_id,
                getattr(self.user, "id", None),
            )
            await self.join_session(self.user)
        else:
            await self.send(text_data=json.dumps({"error": "Unknown websocket action."}))

    @async_session_owner_only
    async def toggle_timer(self):
        timer_state = await self.timer_service.toggle_timer()
        if timer_state == "paused":
            await self.timer_service.cancel_scheduled_cycle_change(self.redis_client)
        elif timer_state == "resumed":
            await self.timer_service.schedule_next_cycle_change(redis_client=self.redis_client)
        await self.send_timer_update_to_all_clients()
        await self.update_session_will_finish_at_to_all_clients()

    @async_session_owner_only
    async def stop_timer(self):
        await self.timer_service.stop_timer()
        await self.timer_service.cancel_scheduled_cycle_change(self.redis_client)
        await self.send_timer_update_to_all_clients()

    @async_session_owner_only
    async def transition_to_next_cycle(self):
        await self.timer_service.change_cycle_if_needed()
        await self.timer_service.schedule_next_cycle_change(redis_client=self.redis_client)
        await self.send_timer_update_to_all_clients()
        await self.update_session_will_finish_at_to_all_clients()

    async def send_timer_update_to_all_clients(self):
        timer_display_data = await self.timer_service.get_timer_display_data()
        await self.channel_layer.group_send(  # type: ignore
            self.session_group_name,
            {
                "type": "timer_update",
                "timer_display_data": timer_display_data,
            },
        )

    async def join_session(self, user):
        if not user.is_authenticated:
            await self.send(text_data=json.dumps({"error": "Login required to join session."}))
            return
        await self.timer_service.join_session(user)
        await self.update_session_followers_list_to_all_clients()

    async def send_throttled_client_broadcasts(self, *, timer=False, will_finish_at=False, followers=False):
        now = monotonic()
        if now - self.last_client_broadcast_at < CLIENT_BROADCAST_MIN_INTERVAL_SECONDS:
            return
        self.last_client_broadcast_at = now
        if timer:
            await self.send_timer_update_to_all_clients()
        if will_finish_at:
            await self.update_session_will_finish_at_to_all_clients()
        if followers:
            await self.update_session_followers_list_to_all_clients()

    async def timer_update(self, data):
        await self.send(text_data=json.dumps(data))

    @database_sync_to_async
    def _get_followers_data(self) -> list[dict[str, str]]:
        followers = self.session.followers.all()
        followers_data = [
            {"username": follower.follower.username, "joined_at": selectors.format_utc_datetime(follower.joined_at)}
            for follower in followers
        ]
        return followers_data

    @database_sync_to_async
    def _get_session_will_finish_at_data(self):
        will_finish_at = selectors.get_session_will_finish_at(request_user=self.user, session=self.session)
        return will_finish_at

    async def update_session_will_finish_at_to_all_clients(self):
        await self.channel_layer.group_send(  # type: ignore
            self.session_group_name,
            {
                "type": "will_finish_at_update",
            },
        )

    async def will_finish_at_update(self, data):
        will_finish_at_timestamp = await self._get_session_will_finish_at_data()
        await self.send(
            text_data=json.dumps(
                {"will_finish_at_timestamp": will_finish_at_timestamp, "type": "will_finish_at_update"}
            )
        )

    async def update_session_followers_list_to_all_clients(self):
        # we don't need to calculate followers list for each client
        # we can just send the followers list to all clients
        followers_data = await self._get_followers_data()
        await self.channel_layer.group_send(  # type: ignore
            self.session_group_name,
            {
                "type": "followers_update",
                "followers": followers_data,
            },
        )

    async def followers_update(self, data):
        await self.send(text_data=json.dumps(data))

    async def sync_inactive_timer(self):
        """
        Sometime OS or Browser pauses the timer from
        client side and then clientside have not idea
        about the server time. so we update that time here
        """
        logger.info(
            "Inactive timer sync requested: session_id=%s user_id=%s at=%s",
            self.session_id,
            getattr(self.user, "id", None),
            datetime.now(),
        )
        await self.send_timer_update_to_all_clients()
        await self.update_session_will_finish_at_to_all_clients()
