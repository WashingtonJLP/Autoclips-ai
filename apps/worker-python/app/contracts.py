from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class Rights(BaseModel):
    model_config = ConfigDict(extra="forbid")
    license: Literal["CC0", "CC-BY-4.0", "PERMISSION", "PROCESSING"]
    evidence_url: HttpUrl
    attribution: str = Field(min_length=1, max_length=2000)
    commercial_use_verified: bool

    @model_validator(mode="after")
    def processing_scope(self):
        if self.license != "PROCESSING" and not self.commercial_use_verified:
            raise ValueError("A licença exige verificação dos direitos comerciais")
        return self


class MediaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=500)
    rights: Rights
    language: Literal["pt", "en", "es"] | None = None


class Segment(BaseModel):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)
    text: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def interval(self):
        if self.end <= self.start:
            raise ValueError("Intervalo inválido")
        return self


class ClipRequest(MediaRequest):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)
    segments: list[Segment] = Field(default_factory=list, max_length=5000)
    burn_subtitles: bool = False

    @model_validator(mode="after")
    def interval(self):
        if not 0 < self.end - self.start <= 180:
            raise ValueError("O corte deve durar entre 0 e 180 segundos")
        return self
