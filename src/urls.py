"""
URL configuration for src project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.contrib.staticfiles.storage import staticfiles_storage
from django.urls import include, path
from django.views.generic.base import RedirectView


def static_asset_redirect(asset_name: str):
    return RedirectView.as_view(url=staticfiles_storage.url(asset_name), permanent=True)

urlpatterns = [
    path("favicon.ico", static_asset_redirect("favicon.ico")),
    path("apple-touch-icon.png", static_asset_redirect("apple-touch-icon.png")),
    path("site.webmanifest", static_asset_redirect("site.webmanifest")),
    path("browserconfig.xml", static_asset_redirect("browserconfig.xml")),
    path("og-image.png", static_asset_redirect("og-image.png")),
    path("control-room-focus1/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("", include("apps.realtime_timer.urls")),
]
