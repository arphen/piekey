SHELL := /bin/bash
NPM_REGISTRY ?= https://registry.npmjs.org
PORT ?= 5173

.PHONY: install run build preview stop test test-file test-related typecheck quick map-update map-check check hooks publish report

install:
	npm install --registry $(NPM_REGISTRY)
	@$(MAKE) --no-print-directory hooks

node_modules/.package-lock.json: package.json package-lock.json
	npm install --registry $(NPM_REGISTRY)
	@touch $@

# Free the port first (TERM, then KILL stragglers), and fail instead of silently moving to another port.
stop:
	@pids=$$(lsof -ti tcp:$(PORT) -sTCP:LISTEN); \
	if [ -n "$$pids" ]; then \
		echo "Stopping process(es) on port $(PORT): $$pids"; \
		kill $$pids 2>/dev/null; \
		for _ in 1 2 3 4 5 6 7 8 9 10; do \
			lsof -ti tcp:$(PORT) -sTCP:LISTEN >/dev/null || break; sleep 0.3; \
		done; \
		pids=$$(lsof -ti tcp:$(PORT) -sTCP:LISTEN); \
		if [ -n "$$pids" ]; then kill -9 $$pids 2>/dev/null; sleep 0.3; fi; \
	fi

run: node_modules/.package-lock.json stop
	npm run dev -- --host 0.0.0.0 --port $(PORT) --strictPort

build:
	npm run build

preview:
	npm run preview -- --host 0.0.0.0 --port 4173

# Quiet by default: summary on success, a bounded tail (and the full log path) on failure.
test:
	@log=$$(mktemp "$${TMPDIR:-/tmp}/guitar-test.XXXXXX"); \
	if npm test > "$$log" 2>&1; then \
		grep -E "Test Files|Tests " "$$log"; \
		rm -f "$$log"; \
	else \
		status=$$?; \
		tail -n 120 "$$log"; \
		echo "Full log: $$log"; \
		exit $$status; \
	fi

typecheck:
	@npm run --silent typecheck

# Fast loop while editing. The full gate is `make check` and belongs at handoff.
quick: typecheck

# One test file: make test-file FILE=src/__tests__/song.test.ts
test-file:
	@test -n "$(FILE)" || { echo "Usage: make test-file FILE=src/__tests__/song.test.ts"; exit 2; }
	@npx vitest run "$(FILE)" --reporter=dot

# Tests Vitest considers related to a source file: make test-related FILE=src/song/deck.ts
test-related:
	@test -n "$(FILE)" || { echo "Usage: make test-related FILE=src/song/deck.ts"; exit 2; }
	@npx vitest related --run "$(FILE)" --reporter=dot

# Regenerate the checked-in symbol index after adding, removing, or renaming files.
map-update:
	@node scripts/generate-repo-map.mjs

map-check:
	@node scripts/generate-repo-map.mjs --check

check: typecheck map-check test

# Point git at the tracked hooks: pre-commit (typecheck + map) and pre-push (full check).
hooks:
	@git config core.hooksPath .githooks
	@echo "git hooks installed from .githooks (pre-commit: typecheck + map, pre-push: make check)"

# One command to ship: commit whatever changed, run the full gate and a build, push to main (which
# deploys GitHub Pages via .github/workflows/pages.yml). Never forced; fails if main moved elsewhere.
#   make publish                      auto message
#   make publish MSG="what I did"     your message
publish:
	@if [ -n "$$(git status --porcelain)" ]; then \
		git add -A; \
		git commit -q -m "$${MSG:-Update: $$(git diff --cached --shortstat | sed 's/^ *//')}" || exit 1; \
		echo "Committed local changes."; \
	fi
	@./scripts/publish-report.sh
	@$(MAKE) --no-print-directory check
	@if [ -z "$(SKIP)" ]; then npm run --silent build:quiet; fi
	@git push --no-verify origin HEAD:main || { echo; echo "Push to main was rejected: main has changes this checkout lacks. Run: git pull --rebase origin main"; exit 1; }
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "main" ]; then git push --no-verify -q origin "$$branch"; fi
	@echo; echo "Published. Pages deploys in about a minute: https://arphen.github.io/piekey/"
	@gh run list --workflow pages.yml --limit 1 2>/dev/null || true

# What a publish would send, and which branches main has not integrated. Changes nothing.
report:
	@./scripts/publish-report.sh
