import importlib
import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.conf import settings
from django.core.asgi import get_asgi_application

# Set the Django settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "src.settings")

# Initialize Django ASGI application early to ensure the AppRegistry is populated
# before importing any models or other parts of the framework that rely on it.
django_asgi_app = get_asgi_application()

# Use ASGIStaticFilesHandler only in development
if settings.DEBUG:
    from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler

    django_asgi_app = ASGIStaticFilesHandler(django_asgi_app)

# Import your application's routing configuration
routing = importlib.import_module("apps.realtime_timer.routing")

# Define the application
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(URLRouter(routing.websocket_urlpatterns)),
    }
)
