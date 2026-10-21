from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = Field(default="local", alias="SHIELDIQ_ENV")
    demo_mode: bool = Field(default=True, alias="SHIELDIQ_DEMO_MODE")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT", ge=1, le=65535)
    api_cors_origins: str = Field(default="http://localhost:3000", alias="API_CORS_ORIGINS")
    google_cloud_project: str | None = Field(default=None, alias="GOOGLE_CLOUD_PROJECT")
    google_cloud_location: str = Field(default="us-central1", alias="GOOGLE_CLOUD_LOCATION")
    google_genai_use_vertexai: bool = Field(default=True, alias="GOOGLE_GENAI_USE_VERTEXAI")
    gemini_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_MODEL")
    firebase_project_id: str | None = Field(default=None, alias="FIREBASE_PROJECT_ID")
    firestore_database_id: str = Field(default="(default)", alias="FIRESTORE_DATABASE_ID")
    bigquery_dataset: str = Field(default="shieldiq", alias="BIGQUERY_DATASET")
    gcs_evidence_bucket: str | None = Field(default=None, alias="GCS_EVIDENCE_BUCKET")
    jwt_issuer: str | None = Field(default=None, alias="JWT_ISSUER")
    jwt_audience: str | None = Field(default=None, alias="JWT_AUDIENCE")
    rate_limit_per_minute: int = Field(default=60, alias="RATE_LIMIT_PER_MINUTE", ge=1)
    session_cookie_name: str = Field(default="shieldiq_session", alias="SESSION_COOKIE_NAME")
    session_cookie_days: int = Field(default=5, alias="SESSION_COOKIE_DAYS", ge=1, le=14)

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_demo_mode(self) -> "Settings":
        if self.demo_mode and self.environment != "local":
            raise ValueError("SHIELDIQ_DEMO_MODE is only allowed when SHIELDIQ_ENV=local")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
