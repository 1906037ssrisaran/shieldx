from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import Annotated

import firebase_admin
from fastapi import Depends, HTTPException, Request, status
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings


class Role(StrEnum):
    ADMIN = "admin"
    FRAUD_ANALYST = "fraud_analyst"
    COMPLIANCE_OFFICER = "compliance_officer"
    RISK_MANAGER = "risk_manager"


@dataclass(frozen=True)
class Principal:
    user_id: str
    tenant_id: str
    role: Role
    email: str | None = None


def _firebase_app(settings: Settings) -> firebase_admin.App:
    try:
        return firebase_admin.get_app()
    except ValueError:
        project_id = settings.firebase_project_id or settings.google_cloud_project
        options = {"projectId": project_id} if project_id else None
        return firebase_admin.initialize_app(options=options)


def _principal_from_verified_token(
    token: str,
    settings: Settings,
    *,
    session_cookie: bool = False,
) -> Principal:
    try:
        app = _firebase_app(settings)
        claims = (
            firebase_auth.verify_session_cookie(token, check_revoked=True, app=app)
            if session_cookie
            else firebase_auth.verify_id_token(token, check_revoked=True, app=app)
        )
    except Exception as error:
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error

    user_id = claims.get("uid")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Verified identity is missing uid")
    try:
        profile = (
            firestore.client(app=app, database_id=settings.firestore_database_id)
            .collection("users")
            .document(user_id)
            .get()
        )
        if not profile.exists:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not provisioned")
        user = profile.to_dict() or {}
        if user.get("status") != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not active")
        try:
            role = Role(user.get("role"))
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User role is invalid") from error
        tenant_id = user.get("tenantId")
        if not isinstance(tenant_id, str) or not tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User tenant is not provisioned")
        return Principal(
            user_id=user_id,
            tenant_id=tenant_id,
            role=role,
            email=claims.get("email") if isinstance(claims.get("email"), str) else None,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail="User authorization service is unavailable") from error


async def get_principal(request: Request) -> Principal:
    settings = get_settings()
    if settings.demo_mode:
        role_value = request.headers.get("x-demo-role", Role.FRAUD_ANALYST.value)
        try:
            role = Role(role_value)
        except ValueError as error:
            raise HTTPException(status_code=403, detail="Unknown demo role") from error
        principal = Principal(
            user_id=request.headers.get("x-demo-user", "demo-analyst"),
            tenant_id="northstar-demo",
            role=role,
            email="analyst@northstar.demo",
        )
        request.state.shieldiq_principal = principal
        return principal

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() == "bearer" and token:
        principal = await run_in_threadpool(_principal_from_verified_token, token, settings)
        request.state.shieldiq_principal = principal
        return principal
    session_token = request.cookies.get(settings.session_cookie_name)
    if session_token:
        principal = await run_in_threadpool(
            _principal_from_verified_token,
            session_token,
            settings,
            session_cookie=True,
        )
        request.state.shieldiq_principal = principal
        return principal
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication is required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_roles(*roles: Role):
    async def dependency(
        principal: Annotated[Principal, Depends(get_principal)],
    ) -> Principal:
        if principal.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return principal

    return dependency


def create_session_cookie(id_token: str, settings: Settings) -> str:
    try:
        return firebase_auth.create_session_cookie(
            id_token,
            expires_in=timedelta(days=settings.session_cookie_days),
            app=_firebase_app(settings),
        )
    except Exception as error:
        raise HTTPException(status_code=401, detail="Firebase ID token is invalid or expired") from error


def revoke_session(cookie: str, settings: Settings) -> None:
    try:
        _principal_from_verified_token(cookie, settings, session_cookie=True)
    except HTTPException:
        return
