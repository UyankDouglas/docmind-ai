from fastapi import APIRouter

from app.api.v1 import (
    admin,
    analyses,
    auth,
    chat,
    collections,
    demo,
    documents,
    search,
    system,
    workspaces,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(system.router)
api_router.include_router(auth.router)
api_router.include_router(workspaces.router)
api_router.include_router(analyses.router)
api_router.include_router(admin.router)
api_router.include_router(documents.router)
api_router.include_router(collections.router)
api_router.include_router(search.router)
api_router.include_router(chat.router)
api_router.include_router(demo.router)

__all__ = ["api_router"]
