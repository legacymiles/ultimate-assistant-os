"""Model-facing code.

Each module here is written so it can be used two ways: imported by the
server when the model's package happens to live in the same interpreter, or
run as a script by another virtualenv's python, talking to the server over
stdin/stdout. That is why they only import the standard library at module
level and keep the heavy imports inside functions, and why the protocol is
three marker lines rather than anything that would need a shared package.
"""
