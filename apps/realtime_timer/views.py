import logging
from typing import Any

from django.contrib.auth.mixins import LoginRequiredMixin
from django.shortcuts import render
from django.views import View
from django.views.generic import TemplateView

from .business_logic import selectors
from .forms import FocusSessionForm

logger = logging.getLogger(__name__)


class HomepageView(TemplateView):
    template_name = "realtime_timer/homepage.html"


class MainSessionView(LoginRequiredMixin, TemplateView):
    """
    Main Session Page from where user can set the timer
    """

    template_name = "realtime_timer/main_session.html"

    def get_context_data(self, **kwargs: Any) -> dict[str, Any]:
        context_data = super().get_context_data(**kwargs)
        context_data["focus_session_form"] = FocusSessionForm()
        return context_data


class SessionDetailView(LoginRequiredMixin, View):
    def get(self, request, session_id):
        focus_session = selectors.get_focus_session_by_id(session_id=session_id)
        is_session_owner = focus_session.owner == request.user
        followers = selectors.get_session_followers(session=focus_session)
        is_session_follower = selectors.is_user_a_session_follower(session=focus_session, user=request.user)
        will_finish_at = selectors.get_session_will_finish_at(request_user=request.user, session=focus_session)
        logger.info("Session detail viewed: session_id=%s user_id=%s", session_id, request.user.id)
        return render(
            request,
            "realtime_timer/session_detail.html",
            {
                "focus_session": focus_session,
                "followers": followers,
                "will_finish_at": will_finish_at,
                "is_session_owner": is_session_owner,
                "is_session_follower": is_session_follower,
            },
        )
