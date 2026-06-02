import pytest

from apps.realtime_timer.business_logic import techniques
from apps.realtime_timer.models import FocusSession


@pytest.mark.django_db
@pytest.mark.parametrize("technique", [choice[0] for choice in FocusSession.TECHNIQUE_CHOICES])
def test_each_focus_session_technique_generates_cycles(user, technique):
    generated_cycle_data = techniques.generate_focus_cycle_data_based_on_technique_and_duration(
        technique=technique,
        total_time=180,
        distribute_extra_time_to_long_cycles=False,
        distribute_extra_time_to_short_cycles=False,
        distribute_extra_time_to_last_25_5_25_5_cycles=False,
        user=user,
    )

    assert generated_cycle_data["total_cycles"] > 0
    assert generated_cycle_data["extra_time_left"] == 0
    assert sum(cycle["duration"] for cycle in generated_cycle_data["cycles"]) == 180
