"""Google Tasks for Penguin: read, add, change, complete and delete tasks on the user's default list. Handed to Gemini as tools.
Own Google sign-in (gcal.session('tasks')), so it can use a different account from Calendar and YouTube."""
from gcal import session

API = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks"

def _call(method, url=API, **kw):
    try: r = session("tasks").request(method, url, timeout=15, **kw)
    except RuntimeError as e: return {"error": str(e)}
    if r.status_code == 204: return {}
    return r.json() if r.ok else {"error": f"tasks error {r.status_code}: {r.text[:200]}"}

def _due(d): return d[:10] + "T00:00:00.000Z" if d else None       # Google Tasks only keeps the date

def list_tasks(include_completed: bool = False) -> str:
    """List the user's Google Tasks (title, due date, id). The id is needed for change_task / complete_task / delete_task."""
    d = _call("GET", params={"maxResults": 50, "showCompleted": str(include_completed).lower(), "showHidden": str(include_completed).lower()})
    if "error" in d: return d["error"]
    return "\n".join(f"{t['id']} | {(t.get('due') or 'no date')[:10]} | {t.get('title', '(no title)')}" + (" | done" if t.get("status") == "completed" else "")
                     for t in d.get("items", [])) or "no tasks"

def add_task(title: str, due: str = "", notes: str = "") -> str:
    """Add a task to the user's Google Tasks. due is an optional date like '2026-10-12' (resolve words like 'tomorrow' from the current date)."""
    body = {"title": title}
    if due: body["due"] = _due(due)
    if notes: body["notes"] = notes
    d = _call("POST", json=body)
    return d.get("error") or f"added task {title!r}" + (f" due {due[:10]}" if due else "")

def change_task(task_id: str, title: str = "", due: str = "", notes: str = "") -> str:
    """Change an existing task (get task_id from list_tasks). Pass only the fields to change."""
    body = {k: v for k, v in (("title", title), ("due", _due(due)), ("notes", notes)) if v}
    d = _call("PATCH", f"{API}/{task_id}", json=body)
    return d.get("error") or f"updated task {d.get('title', '')!r}"

def complete_task(task_id: str) -> str:
    """Mark a task as done (get task_id from list_tasks)."""
    d = _call("PATCH", f"{API}/{task_id}", json={"status": "completed"})
    return d.get("error") or f"completed task {d.get('title', '')!r}"

def delete_task(task_id: str, confirmed: bool = False) -> str:
    """Delete a task (irreversible). Pass confirmed=True only if the user explicitly asked to delete/remove this task; otherwise leave it False and ask them."""
    if not confirmed: return "NOT deleted: ask the user to say so explicitly"
    d = _call("DELETE", f"{API}/{task_id}")
    return d.get("error") or "deleted the task"

TOOLS = [list_tasks, add_task, change_task, complete_task, delete_task]
