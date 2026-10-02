# Continuity Operating Guide

## Purpose

This repository keeps concise, factual continuity in versioned artifacts so work can resume safely without depending on chat history.

## Layers and Paths

| Layer | Purpose | Repository path or operating surface |
| --- | --- | --- |
| Session/thread | Current bounded work, decisions, and open loops | Active task handoff plus the governing issue and pull request |
| Recent/daily | Short-lived progress and run evidence | `.governance/project/bootstrap/history/<timestamp>/` for bootstrap; issue/PR evidence for delivery work |
| Project | Durable constraints, specifications, workflows, and backlog | `AGENTS.md`, `.governance/project/`, `.governance/specs/`, `.governance/rules/` |
| Durable global/operator | Cross-project operator facts that are safe and authorized to retain | Operator-managed continuity surface; do not copy secrets, credentials, raw logs, paths, or private payloads into the repository |

## Checkpoint Triggers

Checkpoint after new instructions or corrections, a material decision, a blocker or open loop, a change of phase or execution mode, prolonged multi-step work, or likely compaction/handoff risk. Each checkpoint states the governing issue/spec, exact checkout and branch, evidence obtained, unresolved risk, and one next action.

## Session Diaries

Recurring work records a concise diary in the governing issue, pull request, or a scoped history artifact. Diary entries retain decisions, constraints, follow-ups, and thread-specific operating norms. They are not transcript archives and must remain secret-safe.

## Promotion Flow

Promote information only when it becomes durable: session facts move into a historical run bundle or issue; reusable project constraints move into a spec, project document, rule, or workflow artifact; cross-project operator knowledge moves only to the authorized operator surface. Update links when a durable fact moves so entry points remain discoverable.

## Default Pickup and Closure

Use the default issue-pickup flow in `.governance/project/GIT_WORKFLOW.md`. Before starting a new slice, assess inherited state on `develop`; use a new typed issue branch from `develop`; classify all kept changes at the end of the slice; and leave an evidence-backed pull request into `develop`. Normal development work never uses `main` as input.
