import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
IS_TESTING = "pytest" in sys.modules or any("pytest" in arg for arg in sys.argv)

LOG_DIR = Path(os.getenv("LOG_DIR", str(BASE_DIR / "logs")))
LOG_DIR.mkdir(parents=True, exist_ok=True)

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY and IS_TESTING:
    SECRET_KEY = "test-secret-key"

DEBUG = os.getenv("DEBUG", "False").lower() in {"1", "true", "yes", "on"}

ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "allauth_ui",
    "allauth",
    "allauth.account",
    "widget_tweaks",
    "slippers",
    "django_htmx",
    "apps.realtime_timer",
    "channels",
]

ALLAUTH_UI_THEME = "forest"


MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django_htmx.middleware.HtmxMiddleware",
]

ROOT_URLCONF = "src.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ASGI_APPLICATION = "src.asgi.application"
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_URL = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/0")

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [(REDIS_HOST, REDIS_PORT)],
        },
    },
}

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}


AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


LANGUAGE_CODE = "en-us"

TIME_ZONE = "Asia/Kolkata"

USE_I18N = True

USE_TZ = True


STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "assets"]
STATICFILES_FINDERS = [
    "django.contrib.staticfiles.finders.FileSystemFinder",
    "django.contrib.staticfiles.finders.AppDirectoriesFinder",
]


staticfiles_storage_backend = "django.contrib.staticfiles.storage.StaticFilesStorage"
if not DEBUG and not IS_TESTING:
    staticfiles_storage_backend = "django.contrib.staticfiles.storage.ManifestStaticFilesStorage"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": staticfiles_storage_backend,
    },
}

STATIC_ROOT = os.path.join(BASE_DIR, "production_static_files")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

AUTH_USER_MODEL = "realtime_timer.User"

SITE_ID = 1

LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"

ACCOUNT_DEFAULT_HTTP_PROTOCOL = "https" if DEBUG is False else "http"
ACCOUNT_LOGIN_METHODS = {"email", "username"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_AUTO_SIGNUP = True

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"


SILENCED_SYSTEM_CHECKS = [
    "slippers.E001",  # we dont need to add any component.yml file for now
    # because some day we will make this as custom page
]

CSRF_TRUSTED_ORIGINS = [origin for origin in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if origin]

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        },
        "app_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOG_DIR / "focus-timer.log"),
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "default",
        },
    },
    "loggers": {
        "django": {
            "handlers": ["console", "app_file"],
            "level": LOG_LEVEL,
            "propagate": True,
        },
        "apps": {
            "handlers": ["console", "app_file"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}
