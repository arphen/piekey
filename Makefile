SHELL := /bin/bash
NPM_REGISTRY ?= https://registry.npmjs.org
PORT ?= 5173

.PHONY: install run build preview stop test test-file test-related typecheck quick map-update map-check check

install:
	npm install --registry $(NPM_REGISTRY)

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
