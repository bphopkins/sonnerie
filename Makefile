UUID    := sonnerie@bphopkins.net
DEST    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
PALETTE := woodblock claves tick marimba bell chime dingdong bourdon
SOUNDS  := $(addprefix src/sounds/,$(addsuffix .wav,$(PALETTE)))

.PHONY: install uninstall enable disable sounds listen check pack clean

install: check $(SOUNDS)
	mkdir -p $(DEST)
	rsync -a --delete src/ $(DEST)/
	glib-compile-schemas $(DEST)/schemas
	@echo "Installed to $(DEST)"
	@echo "If this is the first install (or after an edit), log out and back"
	@echo "in, then: make enable"

uninstall:
	gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(DEST)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

$(SOUNDS) sounds: tools/make_sounds.py
	python3 tools/make_sounds.py

listen: $(SOUNDS)
	@for s in $(PALETTE); do \
		echo $$s:; paplay src/sounds/$$s.wav; sleep 0.3; \
	done

# Syntax-check the ESM sources and validate the GSettings schema without
# touching the live install.
check:
	@for f in src/extension.js src/prefs.js; do \
		cp $$f /tmp/sonnerie-check.mjs && node --check /tmp/sonnerie-check.mjs \
			&& echo "$$f: syntax OK" || exit 1; \
	done
	@rm -f /tmp/sonnerie-check.mjs
	@tmp=$$(mktemp -d) && cp src/schemas/*.xml $$tmp/ \
		&& glib-compile-schemas --strict $$tmp && echo "schema: OK" \
		&& rm -rf $$tmp

# Build the reviewable zip for extensions.gnome.org. Schemas ship as
# source only (the shell compiles them on install); sounds ride along as
# extra sources.
pack: check $(SOUNDS)
	mkdir -p dist
	gnome-extensions pack src \
		--extra-source=sounds \
		--force -o dist
	@echo "Packed: dist/$(UUID).shell-extension.zip"

clean:
	rm -f src/sounds/*.wav
	rm -rf dist
