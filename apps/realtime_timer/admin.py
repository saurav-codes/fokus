from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import FocusCycle, FocusPeriod, FocusSession, SessionFollower, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = (
        "id",
        "username",
        "email",
        "is_staff",
        "is_active",
        "timezone",
        "last_login",
        "date_joined",
    )
    fieldsets = (
        (None, {"fields": ("username",)}),
        ("Personal info", {"fields": ("first_name", "last_name", "email", "timezone")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ("Preferences", {"fields": ("timezone",)}),
    )


@admin.register(FocusSession)
class FocusSessionAdmin(admin.ModelAdmin):
    list_display = (
        "technique",
        "session_id",
        "owner",
        "created_at",
        "current_cycle",
        "timer_started_at",
        "total_focus_completed",
        "timer_state",
    )
    list_filter = (
        "owner",
        "created_at",
        "current_cycle",
        "timer_started_at",
    )
    date_hierarchy = "created_at"


@admin.register(FocusPeriod)
class FocusPeriodAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "session",
        "cycle",
        "started_at",
        "ended_at",
        "duration",
    )
    list_filter = ("started_at", "ended_at")


@admin.register(FocusCycle)
class FocusCycleAdmin(admin.ModelAdmin):
    list_display = ("id", "session", "cycle_type", "duration", "order")
    raw_id_fields = ("session",)


@admin.register(SessionFollower)
class SessionFollowerAdmin(admin.ModelAdmin):
    list_display = ("id", "follower", "session", "joined_at")
    list_filter = ("follower", "session", "joined_at")
    date_hierarchy = "joined_at"
