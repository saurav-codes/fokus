from django.urls import reverse


def test_homepage_is_public(client):
    response = client.get(reverse("realtime_timer:home"))

    assert response.status_code == 200
    assert b"Lazyplanner Focus Timer" in response.content
