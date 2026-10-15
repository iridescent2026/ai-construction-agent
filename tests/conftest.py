import pytest


@pytest.fixture(autouse=True)
def isolate_personal_model_settings(monkeypatch):
    """Unit tests must not inherit a developer's encrypted live credentials."""
    from gis import local_model_settings
    monkeypatch.setattr(local_model_settings, 'local_model_settings', lambda: {})
