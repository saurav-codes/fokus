import logging
import time

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models import Q, Sum
from django.http import HttpRequest, HttpResponse
from django.utils import timezone

from ..models import FocusCycle, FocusPeriod, FocusSession, SessionFollower

logger = logging.getLogger(__name__)
User = get_user_model()
SCHEDULED_CYCLE_CHANGES_KEY = "scheduled_cycle_changes"
MAX_CYCLE_COUNT = 250
MAX_CYCLE_DURATION_MINUTES = 600
MAX_TOTAL_CYCLE_DURATION_MINUTES = (17 * 60) + 59


def create_focus_cycles_and_session(
    focus_session_form_cleaned_data: dict,
    fetched_focus_cycle_data_from_post_request: dict,
    owner,
) -> FocusSession | ValidationError:
    """
    Create a focus session and its focus cycles\n
    example of fetched_focus_cycle_data_from_post_request:
    ```{
        1: {
            "type": "FOCUS",
            "duration": 25
        },
        2: {
            "type": "BREAK",
            "duration": 5
        },
        ....
    }
    note: saving a new object will start the timer immediately
    """
    focus_session = FocusSession.objects.create(
        owner=owner,
        technique=focus_session_form_cleaned_data["technique"],
    )

    # Create focus cycles
    for order, cycle_data in fetched_focus_cycle_data_from_post_request.items():
        try:
            fc = FocusCycle(
                session=focus_session,
                cycle_type=cycle_data["type"],
                duration=timezone.timedelta(minutes=cycle_data["duration"]),
                order=order,
            )
            fc.full_clean()
            fc.save()
        # except the value error from the duration field
        except ValidationError as e:
            focus_session.delete()
            return e

    # since we have created the focus cycles but the instance is not updated
    # we need to refresh the instance from the database
    focus_session.refresh_from_db()

    # Set the current cycle to the first cycle
    # TODO: use django stub to fix these type errors
    first_cycle = focus_session.focus_cycles.first()  # type: ignore
    if first_cycle:
        focus_session.current_cycle = first_cycle
        focus_session.save()

    # create first focus period because the focus session is started.
    FocusPeriod.objects.create(session=focus_session, cycle=first_cycle, user=owner)
    return focus_session


def fetch_focus_cycles_data_from_post_request(request: HttpRequest) -> dict | HttpResponse:
    cycles_types = request.POST.getlist("focus_cycle_type")
    cycles_durations = request.POST.getlist("focus_cycle_duration")
    if len(cycles_types) != len(cycles_durations):
        return HttpResponse("Each cycle must include a type and duration.", status=400)
    if not cycles_types:
        return HttpResponse("At least one focus cycle is required.", status=400)
    if len(cycles_types) > MAX_CYCLE_COUNT:
        return HttpResponse(f"A session can include at most {MAX_CYCLE_COUNT} cycles.", status=400)
    try:
        cycles = {}
        total_duration = 0
        for i, (cycle_type, duration) in enumerate(zip(cycles_types, cycles_durations, strict=True), start=1):
            cycle_duration = int(duration)
            if cycle_type not in {FocusCycle.FOCUS, FocusCycle.BREAK}:
                return HttpResponse("Cycle type must be FOCUS or BREAK.", status=400)
            if cycle_duration < 1 or cycle_duration > MAX_CYCLE_DURATION_MINUTES:
                return HttpResponse(
                    f"Cycle duration must be between 1 and {MAX_CYCLE_DURATION_MINUTES} minutes.", status=400
                )
            total_duration += cycle_duration
            cycles[i] = {"type": cycle_type, "duration": cycle_duration}
        if total_duration > MAX_TOTAL_CYCLE_DURATION_MINUTES:
            return HttpResponse(
                f"Total session duration must be at most {MAX_TOTAL_CYCLE_DURATION_MINUTES} minutes.", status=400
            )
        return cycles
    except ValueError:
        return HttpResponse("Duration must be an integer.", status=400)


class AsyncTimerService:
    def __init__(self, session: FocusSession | str, user, username: str | None = None) -> None:
        self.session = session
        self.user = user
        self.username = username or getattr(user, "username", "")

    @database_sync_to_async
    def _refresh_session(self):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)
            return self.session
        self.session = FocusSession.objects.select_related("owner", "current_cycle").get(
            session_id=self.session.session_id
        )
        return self.session

    @database_sync_to_async
    def _get_timer_state(self):
        return self.session.timer_state

    @database_sync_to_async
    def _get_session_owner(self):
        return self.session.owner

    @database_sync_to_async
    def _get_current_cycle(self):
        return FocusCycle.objects.get(id=self.session.current_cycle_id)  # type: ignore

    async def _create_new_focus_period(self):
        current_cycle = await self._get_current_cycle()
        await database_sync_to_async(FocusPeriod.objects.create)(
            session=self.session,
            cycle=current_cycle,
            user=self.session.owner,
        )

    @database_sync_to_async
    def _get_completed_fp_duration_for_current_cycle(self, current_cycle):
        completed_fp_duration = (
            FocusPeriod.objects.filter(
                cycle=current_cycle,
                ended_at__isnull=False,
            )
            .filter(Q(user=current_cycle.session.owner) | Q(user__isnull=True))
            .only("duration")
            .aggregate(total_time_focused=Sum("duration"))["total_time_focused"]
        )
        if not completed_fp_duration:
            # this means that this session is just started which is why it doesn't have
            # any finished sessions yet so we set an 0 timedelta so that it doesn't give
            # any error in calculations
            completed_fp_duration = timezone.timedelta(0)
        return completed_fp_duration

    @database_sync_to_async
    def _get_duration_for_unfinished_fp_for_current_cycle(self, current_cycle):
        timer_started_at_for_unfinished_fp = (
            FocusPeriod.objects.filter(
                cycle=current_cycle,
                ended_at__isnull=True,  # the current focus period
            )
            .filter(Q(user=current_cycle.session.owner) | Q(user__isnull=True))
            .only("started_at")
            .first()
        )
        if timer_started_at_for_unfinished_fp:
            duration_for_unfinished_fp = timezone.now() - timer_started_at_for_unfinished_fp.started_at
        else:
            duration_for_unfinished_fp = timezone.timedelta(0)
        return duration_for_unfinished_fp

    async def _get_all_focus_period_duration_for_current_cycle(self, current_cycle) -> timezone.timedelta:
        total_time_focused_for_finished_fp = await self._get_completed_fp_duration_for_current_cycle(current_cycle)
        duration_for_unfinished_fp = await self._get_duration_for_unfinished_fp_for_current_cycle(current_cycle)
        return total_time_focused_for_finished_fp + duration_for_unfinished_fp

    async def _get_remaining_seconds_for_current_cycle(self) -> int:
        await self._refresh_session()
        current_cycle = await self._get_current_cycle()
        all_focus_period_duration = await self._get_all_focus_period_duration_for_current_cycle(current_cycle)
        remaining_time = current_cycle.duration.seconds - all_focus_period_duration.seconds
        return max(remaining_time, 0)

    async def _save_last_focus_period_of_current_session(self):
        """
        this function is used to end the last focus period of the current session
        it's used when the timer is paused or stopped or when the user is done with the current cycle
        so we save the time for the last focus period.
        """
        # get the last focus period
        owner_periods = self.session.focus_periods.filter(  # type: ignore
            Q(user=self.session.owner) | Q(user__isnull=True)
        )
        last_focus_period = await database_sync_to_async(owner_periods.last)()
        if last_focus_period and not last_focus_period.ended_at:
            # if the last focus period is not ended, end it
            last_focus_period.ended_at = timezone.now()
            # calculate the duration of the last focus period
            fp_duration = last_focus_period.ended_at - last_focus_period.started_at
            # sometime this method is called after a long time like
            # when tab/browser sleeps & as they get active again, it's
            # more time passed already then it was in cycle.
            max_time_to_save_for_focus_period = await self._get_max_time_to_save_for_focus_period()
            last_focus_period.duration = min(fp_duration, max_time_to_save_for_focus_period)
            await last_focus_period.asave()
            logger.debug(
                "Saved focus period: duration=%s max_duration=%s period_id=%s",
                last_focus_period.duration,
                max_time_to_save_for_focus_period,
                last_focus_period.id,
            )

    async def _get_max_time_to_save_for_focus_period(self):
        """
        this function returns the max duration we can save to current focus period
        while keeping in mind that sometime this method is called after a long time
        like when tab/browser sleeps & as they get active again, it's more time
        passed already then it was in cycle duration. so we need to make sure that
        we don't save more time then the cycle duration time left in the current cycle.
        """
        # first get all focus periods for the current cycle
        current_cycle = await self._get_current_cycle()
        completed_fp_duration = await self._get_completed_fp_duration_for_current_cycle(current_cycle)
        return current_cycle.duration - completed_fp_duration

    async def _calculate_total_focus_completed(self):
        # either choose the last resumed time or the started time
        # because the last resumed time will be None if the user started the session
        # and it will contain value if the user resumed the session
        # only call this method once the session is completed
        owner_periods = self.session.focus_periods.filter(  # type: ignore
            Q(user=self.session.owner) | Q(user__isnull=True),
            cycle__cycle_type=FocusCycle.FOCUS,
        )
        total_focused_time_qs = await database_sync_to_async(owner_periods.aggregate)(
            total_time_focused=Sum("duration")
        )
        total_focused_time = total_focused_time_qs["total_time_focused"] or timezone.timedelta(0)
        return total_focused_time

    async def pause_timer(self):
        await self._refresh_session()
        if self.session.timer_state == FocusSession.TIMER_RUNNING:
            self.session.timer_state = FocusSession.TIMER_PAUSED
            await self.session.asave()
            await self._save_last_focus_period_of_current_session()
            await self._end_all_participant_focus_periods()
            return "paused"
        return self.session.timer_state

    async def stop_timer(self):
        """
        doesn't matter if the session is completed or not.
        we will just calculate all the time spent and end the last focus period
        and mark the session as completed
        """
        logger.debug("Stopping timer: user=%s timezone=%s", self.user.username, self.user.timezone)
        await self.pause_timer()  # make sure the last focus period is ended
        await self._refresh_session()
        await self._end_all_participant_focus_periods()
        self.session.total_focus_completed = await self._calculate_total_focus_completed()
        self.session.timer_state = FocusSession.TIMER_COMPLETED
        await self.session.asave()
        return "completed"

    async def resume_timer(self):
        await self._refresh_session()
        if self.session.timer_state == FocusSession.TIMER_PAUSED:
            # just add a new focus period
            await self._create_new_focus_period()
            self.session.timer_state = FocusSession.TIMER_RUNNING
            await self.session.asave()
            await self._start_focus_periods_for_authenticated_followers()
            return "resumed"
        return self.session.timer_state

    async def toggle_timer(self):
        await self._refresh_session()
        timer_state = self.session.timer_state
        if timer_state == FocusSession.TIMER_RUNNING:
            return await self.pause_timer()
        elif timer_state == FocusSession.TIMER_PAUSED:
            return await self.resume_timer()
        return timer_state

    @database_sync_to_async
    def _add_user_to_session_followers(self, user, guest_name: str | None = None):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)

        if user.is_authenticated:
            if user == self.session.owner:
                return None
            follower, _created = SessionFollower.objects.get_or_create(
                follower=user,
                session=self.session,
                defaults={"username": user.username, "user_type": SessionFollower.AUTHENTICATED},
            )
            if follower.username != user.username or follower.user_type != SessionFollower.AUTHENTICATED:
                follower.username = user.username
                follower.user_type = SessionFollower.AUTHENTICATED
                follower.save(update_fields=["username", "user_type"])
            return {"username": follower.display_name, "user_type": follower.user_type}

        display_name = (guest_name or "").strip()
        if not display_name:
            raise ValueError("Guest name is required.")
        follower, _created = SessionFollower.objects.get_or_create(
            session=self.session,
            username=display_name,
            defaults={"user_type": SessionFollower.GUEST},
        )
        return {"username": follower.display_name, "user_type": follower.user_type}

    @database_sync_to_async
    def _start_participant_focus_period(self, user):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)
        if not user.is_authenticated or user == self.session.owner:
            return
        if self.session.timer_state != FocusSession.TIMER_RUNNING or not self.session.current_cycle_id:
            return
        FocusPeriod.objects.get_or_create(
            session=self.session,
            user=user,
            ended_at=None,
            defaults={"cycle": self.session.current_cycle},
        )

    @database_sync_to_async
    def _end_participant_focus_period(self, user):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)
        if not user.is_authenticated or user == self.session.owner:
            return
        now = timezone.now()
        open_periods = (
            FocusPeriod.objects.filter(session=self.session, user=user, ended_at__isnull=True).select_related("cycle")
        )
        for period in open_periods:
            period.ended_at = now
            elapsed = max(now - period.started_at, timezone.timedelta(0))
            period.duration = min(elapsed, self._get_remaining_duration_for_period_user(period))
            period.save(update_fields=["ended_at", "duration"])

    @database_sync_to_async
    def _end_all_participant_focus_periods(self):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)
        now = timezone.now()
        open_periods = (
            FocusPeriod.objects.filter(session=self.session, ended_at__isnull=True)
            .exclude(Q(user=self.session.owner) | Q(user__isnull=True))
            .select_related("cycle")
        )
        for period in open_periods:
            period.ended_at = now
            elapsed = max(now - period.started_at, timezone.timedelta(0))
            period.duration = min(elapsed, self._get_remaining_duration_for_period_user(period))
            period.save(update_fields=["ended_at", "duration"])

    def _get_remaining_duration_for_period_user(self, period):
        completed_duration = (
            FocusPeriod.objects.filter(
                session=period.session,
                cycle=period.cycle,
                user=period.user,
                ended_at__isnull=False,
            )
            .exclude(pk=period.pk)
            .aggregate(total=Sum("duration"))["total"]
            or timezone.timedelta(0)
        )
        return max(period.cycle.duration - completed_duration, timezone.timedelta(0))

    @database_sync_to_async
    def _start_focus_periods_for_authenticated_followers(self):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)
        if self.session.timer_state != FocusSession.TIMER_RUNNING or not self.session.current_cycle_id:
            return
        followers = SessionFollower.objects.filter(session=self.session, follower__isnull=False).exclude(
            follower=self.session.owner
        )
        for follower in followers:
            FocusPeriod.objects.get_or_create(
                session=self.session,
                user=follower.follower,
                ended_at=None,
                defaults={"cycle": self.session.current_cycle},
            )

    @database_sync_to_async
    def _remove_user_from_session_followers(self, user, guest_name: str | None = None):
        if isinstance(self.session, str):
            self.session = FocusSession.objects.select_related("owner", "current_cycle").get(session_id=self.session)
        if user.is_authenticated:
            SessionFollower.objects.filter(session=self.session, follower=user).delete()
        elif guest_name:
            SessionFollower.objects.filter(session=self.session, username=guest_name).delete()

    async def join_session(self, user, guest_name: str | None = None):
        follower = await self._add_user_to_session_followers(user, guest_name=guest_name)
        await self._start_participant_focus_period(user)
        return follower

    async def leave_session(self, user, guest_name: str | None = None):
        await self._end_participant_focus_period(user)
        await self._remove_user_from_session_followers(user, guest_name=guest_name)

    async def get_timer_display_data(self):
        """
        return the remaining for current cycle.
        it uses cache and needs to be called every second to count
        correctly.
        call this inside the websocket consumer every second to send
        the update time to the client
        """
        await self._refresh_session()
        data = {
            "remaining_time": 0,
            "current_cycle": {},
            "focus_cycles": {},
            "timer_state": self.session.timer_state,
        }
        if not self.session.timer_state == FocusSession.TIMER_COMPLETED:
            current_cycle = await self._get_current_cycle()
            # also get all focus period durations
            all_focus_period_duration = await self._get_all_focus_period_duration_for_current_cycle(current_cycle)
            if current_cycle:
                remaining_time = current_cycle.duration.seconds - all_focus_period_duration.seconds
                if remaining_time < 0:
                    remaining_time = 0
                data["remaining_time"] = remaining_time
                data["current_cycle"] = {
                    "type": current_cycle.cycle_type,
                    "order": current_cycle.order,
                    "duration_seconds": current_cycle.duration.seconds,
                }
                # also add remaining cycles data
                focus_cycles = await database_sync_to_async(list)(
                    self.session.focus_cycles.all()  # type: ignore
                )  # get all cycles after current one
                for focus_cycle in focus_cycles:
                    data["focus_cycles"][str(focus_cycle.order)] = {
                        "type": focus_cycle.cycle_type,
                        "duration_seconds": focus_cycle.duration.seconds,
                        "is_completed": focus_cycle.is_completed,
                        "order": focus_cycle.order,
                    }
        return data

    async def transition_to_next_cycle(self):
        """
        here we invalidate the cache when"""
        await self._refresh_session()
        await self._save_last_focus_period_of_current_session()
        current_cycle = await self._get_current_cycle()
        current_cycle.is_completed = True
        await current_cycle.asave()
        next_cycles_qs = await database_sync_to_async(self.session.focus_cycles.filter)(  # type: ignore
            order__gt=current_cycle.order
        )
        next_cycle = await database_sync_to_async(next_cycles_qs.first)()
        if next_cycle:
            self.session.current_cycle = next_cycle
            await self.session.asave()
            await self._end_all_participant_focus_periods()
            # create a new focus period for the next cycle
            await database_sync_to_async(FocusPeriod.objects.create)(
                session=self.session,
                cycle=next_cycle,
                user=self.session.owner,
            )
            await self._start_focus_periods_for_authenticated_followers()
            return True
        else:
            # since there is no next cycle, we will stop the timer
            await self.stop_timer()
            return False

    async def change_cycle_if_needed(self, session: FocusSession | None = None):
        if session is not None:
            self.session = session
        await self._refresh_session()
        if self.session.timer_state != FocusSession.TIMER_RUNNING:
            return False
        remaining_seconds = await self._get_remaining_seconds_for_current_cycle()
        if remaining_seconds > 0:
            return False
        return await self.transition_to_next_cycle()

    async def schedule_current_cycle_change(self, redis_client):
        await self._refresh_session()
        if self.session.timer_state != FocusSession.TIMER_RUNNING:
            await self.cancel_scheduled_cycle_change(redis_client)
            return None
        remaining_seconds = await self._get_remaining_seconds_for_current_cycle()
        next_change_timestamp = time.time() + remaining_seconds
        await redis_client.zadd(SCHEDULED_CYCLE_CHANGES_KEY, {str(self.session.session_id): next_change_timestamp})
        logger.info(
            "Scheduled cycle change: session_id=%s remaining_seconds=%s",
            self.session.session_id,
            remaining_seconds,
        )
        return next_change_timestamp

    async def schedule_next_cycle_change(self, redis_client):
        return await self.schedule_current_cycle_change(redis_client)

    async def cancel_scheduled_cycle_change(self, redis_client):
        await redis_client.zrem(SCHEDULED_CYCLE_CHANGES_KEY, str(self.session.session_id))
        logger.info("Cancelled scheduled cycle change: session_id=%s", self.session.session_id)

    async def cancel_scheduled_cycle_change_if_timer_not_running(self, redis_client):
        await self._refresh_session()
        if self.session.timer_state != FocusSession.TIMER_RUNNING:
            await self.cancel_scheduled_cycle_change(redis_client)


async def trigger_timer_update_for_session(session_id: str):
    session = await database_sync_to_async(FocusSession.objects.select_related("owner").get)(session_id=session_id)
    service = AsyncTimerService(session=session, user=session.owner)
    timer_display_data = await service.get_timer_display_data()
    channel_layer = get_channel_layer()
    await channel_layer.group_send(
        f"focus_session_{session_id}",
        {
            "type": "timer_update",
            "timer_display_data": timer_display_data,
        },
    )
    await channel_layer.group_send(
        f"focus_session_{session_id}",
        {
            "type": "will_finish_at_update",
        },
    )


async def trigger_sync_timer_for_all_connected_clients(session_id: str):
    await trigger_timer_update_for_session(session_id)
