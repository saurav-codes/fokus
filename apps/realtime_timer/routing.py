from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(
        r"ws/focus_session/(?P<session_id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/$",
        consumers.FocusSessionConsumer.as_asgi(),
    ),
]
