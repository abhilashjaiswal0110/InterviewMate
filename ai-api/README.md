# InterviewMate AI API

A FastAPI service that powers the AI capabilities of InterviewMate. This replaces
the legacy Azure-hosted endpoints with a richer, **deep-agent** pipeline.

## Improvements over the original

| Feature | Original | New |
|---|---|---|
| Question generation | Single-shot GPT call | Two-step agent: analyser → generator |
| Seniority awareness | ❌ | ✅ Intern / Junior / Mid / Senior / Staff |
| Topic focus | ❌ | ✅ React, System Design, Python, etc. |
| Interview analysis | Single-step | Three specialised sub-agents + aggregator |
| Persistent memory | ❌ | ✅ SQLite session memory (cross-session context) |
| Hiring recommendation | ❌ | ✅ Strong Yes / Yes / Maybe / No |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check |
| POST | `/take-description` | Generate initial questions from job description |
| POST | `/new-questions` | Generate follow-up questions from conversation |
| POST | `/analyze` | Full deep-agent analysis of the interview session |

## Request / response examples

### `POST /take-description`

```json
{
  "description": "Senior React engineer for e-commerce platform",
  "seniority": "senior",
  "topics": "React, TypeScript, System Design",
  "meeting_id": "/mock-interview/abc123"
}
```

Returns `{"question_1": "...", "question_2": "...", ..., "question_5": "..."}`.

### `POST /analyze`

```json
{
  "description": "...",
  "conversations": [
    {"role": "interviewer", "text": "Explain React hooks."},
    {"role": "interviewee", "text": "Hooks let you use state in functional components..."}
  ],
  "seniority": "mid",
  "topics": "React",
  "meeting_id": "/mock-interview/abc123"
}
```

Returns a full report including `technical_skills`, `communication_skills`,
`cultural_fit`, `overall_rating`, `strengths`, `improvement_areas`, and
`hiring_recommendation`.

## Setup

```bash
cd ai-api
pip install -r requirements.txt
cp ../.env .env          # must contain OPENAI_API_KEY
uvicorn main:app --reload --port 8001
```

Point the `ws-be` backend at `http://localhost:8001` instead of the Azure URL.
