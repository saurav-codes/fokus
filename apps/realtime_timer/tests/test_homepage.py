from django.urls import reverse


def test_homepage_is_public(client):
    response = client.get(reverse("realtime_timer:home"))

    assert response.status_code == 200
    assert b"Lazyplanner Focus Timer" in response.content


def test_homepage_has_brand_metadata(client):
    response = client.get(reverse("realtime_timer:home"), secure=True)
    content = response.content.decode()

    assert '<meta name="description" content="Create shareable live focus sessions' in content
    assert '<meta property="og:title" content="Lazyplanner&#x27;s Focus Timer">' in content
    assert '<meta property="og:image" content="https://testserver/static/og-image.png">' in content
    assert '<meta name="twitter:card" content="summary_large_image">' in content
    assert '<link rel="manifest" href="/static/site.webmanifest">' in content
    assert '<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">' in content


def test_root_favicon_redirects_to_static_asset(client):
    response = client.get("/favicon.ico")

    assert response.status_code == 301
    assert response["Location"] == "/static/favicon.ico"
