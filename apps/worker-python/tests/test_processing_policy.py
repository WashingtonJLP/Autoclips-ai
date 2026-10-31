import pytest
from pydantic import ValidationError

from app.contracts import Rights


def test_processing_request_does_not_claim_commercial_rights():
    scope = {
        "license": "PROCESSING",
        "evidence_url": "https://example.org/video",
        "attribution": "Operador autenticado",
        "commercial_use_verified": False,
    }
    assert Rights(**scope).commercial_use_verified is False
    with pytest.raises(ValidationError):
        Rights(**(scope | {"license": "PERMISSION"}))
