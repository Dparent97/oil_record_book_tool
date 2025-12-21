# Project Learnings - Oil Record Book Tool / Engine Room Status Board

*Lessons learned during development. Synced to central learnings repo via `capture-learnings` skill.*

---

## Iteration 1 (MVP Build)

### Architecture Decisions
- **Project scope creep (good kind)**: Started as ORB tool, evolved to Engine Room Status Board
- **Feature prioritization**: Dashboard with at-a-glance status more valuable than pure compliance tool
- **Two-crew rotation pattern**: App must generate handover packages matching traditional formats

### Flask Patterns
- **Services layer**: `sounding_service.py`, `fuel_service.py` for business logic separation
- **Type hints everywhere**: Helps Claude Code agents understand function signatures
- **Test coverage**: Service tests first, API tests second priority

### Data Model
- **Tank naming**: 17P = Oily Water (Code I), 17S = Dirty Oil (Code C)
- **Sounding tables**: Need feet/inches → gallons → m³ conversion tables as data

### Deprecation Issues
- **datetime.utcnow()**: Deprecated in Python 3.12+
  ```python
  # Old:
  datetime.utcnow()
  
  # New:
  from datetime import datetime, timezone
  datetime.now(timezone.utc)
  ```

### What Worked
- 22 tests, all passing
- Clean Flask app factory pattern
- Comprehensive API (~25 endpoints)

### What's Missing
- Handover package generation (the actual value prop)
- OCR auto-fill (designed but not built)
- API/integration tests

---

## Patterns to Extract to Central Repo

- [ ] datetime.utcnow() → datetime.now(timezone.utc) migration pattern
- [ ] Flask services layer pattern
- [ ] Sounding table data structure
