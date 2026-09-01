"""Studio domain: projects, their pages, version checkpoints and op batches.

Built on app/auth/ the same way app/example/ demonstrated: plain SQLAlchemy
models on the shared Base, Pydantic schemas, and a router guarded by the
auth module's permission system, scoped to an *organisation*.
"""
