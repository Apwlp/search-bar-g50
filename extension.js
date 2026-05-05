import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import St from "gi://St";
import Shell from "gi://Shell";
import Meta from "gi://Meta";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";

export default class SearchLight50 extends Extension {
  enable() {
    this._container = null;
    this._settings = this.getSettings("org.gnome.shell.extensions.searchbar");

    Main.wm.addKeybinding(
      "my-search-shortcut",
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => this._toggleSearch(),
    );
  }

  _toggleSearch() {
    if (this._container) {
      this._destroySearch();
    } else {
      this._showSearch();
    }
  }

  _showSearch() {
    const monitor = Main.layoutManager.primaryMonitor;

    this._selectedIndex = -1;
    this._resultButtons = [];

    this._signals = [];

    this._container = new St.BoxLayout({
      vertical: true,
      style_class: "search-container",
      x: monitor.x + monitor.width / 2 - 250,
      y: monitor.y + monitor.height / 3,
      clip_to_allocation: false,
      reactive: true,
    });

    this._entry = new St.Entry({
      hint_text: "Search...",
      can_focus: true,
      style_class: "search-entry",
    });

    this._resultsBin = new St.BoxLayout({
      vertical: true,
      style_class: "results-list",
    });
    this._resultsBin.hide();

    let textSig = this._entry.clutter_text.connect("notify::text", () => {
      this._updateResults(this._entry.get_text());
    });
    this._signals.push({ actor: this._entry.clutter_text, id: textSig });

    let keySig = this._entry.clutter_text.connect(
      "key-press-event",
      (actor, event) => {
        let symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
          this._destroySearch();
          return Clutter.EVENT_STOP;
        } else if (symbol === Clutter.KEY_Down) {
          this._selectNext();
          return Clutter.EVENT_STOP;
        } else if (symbol === Clutter.KEY_Up) {
          this._selectPrevious();
          return Clutter.EVENT_STOP;
        } else if (
          symbol === Clutter.KEY_Return ||
          symbol === Clutter.KEY_KP_Enter
        ) {
          this._executeSearch(this._entry.get_text());
          return Clutter.EVENT_STOP;
        } else if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_Right) {
          this._executeSearch(this._entry.get_text());
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      },
    );
    this._signals.push({ actor: this._entry.clutter_text, id: keySig });

    let scrollSig = this._container.connect("scroll-event", (actor, event) => {
      let direction = event.get_scroll_direction();
      if (direction === Clutter.ScrollDirection.UP) {
        this._selectPrevious();
      } else if (direction === Clutter.ScrollDirection.DOWN) {
        this._selectNext();
      }
      return Clutter.EVENT_STOP;
    });
    this._signals.push({ actor: this._container, id: scrollSig });

    this._container.add_child(this._entry);
    this._container.add_child(this._resultsBin);

    Main.layoutManager.addChrome(this._container);
    this._entry.grab_key_focus();
  }

  // --- Logic ---
  _selectNext() {
    if (this._resultButtons.length === 0) return;
    let newIndex = this._selectedIndex + 1;
    if (newIndex >= this._resultButtons.length) newIndex = 0;
    this._applySelection(newIndex);
  }

  _selectPrevious() {
    if (this._resultButtons.length === 0) return;
    let newIndex = this._selectedIndex - 1;
    if (newIndex < 0) newIndex = this._resultButtons.length - 1; // Va al final
    this._applySelection(newIndex);
  }

  _applySelection(index) {
    if (
      this._selectedIndex >= 0 &&
      this._selectedIndex < this._resultButtons.length
    ) {
      this._resultButtons[this._selectedIndex].remove_style_class_name(
        "selected",
      );
    }

    this._selectedIndex = index;

    if (
      this._selectedIndex >= 0 &&
      this._selectedIndex < this._resultButtons.length
    ) {
      this._resultButtons[this._selectedIndex].add_style_class_name("selected");
    }
  }

  _updateResults(text) {
    this._resultsBin.destroy_all_children();
    this._resultButtons = [];
    this._selectedIndex = -1;

    if (text.trim().length === 0) {
      this._resultsBin.hide();
      return;
    }

    const searchTerm = text.toLowerCase();
    const appSystem = Shell.AppSystem.get_default();
    const allApps = appSystem.get_installed();

    const matches = [];
    const seenNames = new Set();

    for (let app of allApps) {
      let realName = app.get_name() || "";
      let nameLower = realName.toLowerCase();
      let id = (app.get_id() || "").toLowerCase();

      if (nameLower.includes(searchTerm) || id.includes(searchTerm)) {
        let baseName = nameLower.split("-")[0].trim();

        if (!seenNames.has(baseName)) {
          seenNames.add(baseName);
          matches.push(app);
        }
      }

      if (matches.length >= 5) break;
    }

    if (matches.length === 0) {
      this._resultsBin.hide();
      return;
    }

    this._resultsBin.show();

    matches.forEach((app, index) => {
      let box = new St.BoxLayout({
        vertical: false,
        style: "spacing: 15px;",
      });

      let icon = new St.Icon({
        gicon: app.get_icon(),
        fallback_icon_name: "application-x-executable",
        icon_size: 32,
        style_class: "result-icon",
      });

      let label = new St.Label({
        text: app.get_name(),
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "result-label",
      });

      box.add_child(icon);
      box.add_child(label);

      let button = new St.Button({
        style_class: "result-item",
        reactive: true,
        can_focus: true,
        x_expand: true,
        y_expand: true,
      });

      button.set_child(box);
      button._appReference = app;

      button.connect("enter-event", () => {
        this._applySelection(index);
        return Clutter.EVENT_PROPAGATE;
      });

      button.connect("clicked", () => {
        this._launchApp(app);
      });

      this._resultButtons.push(button);
      this._resultsBin.add_child(button);
    });

    if (this._resultButtons.length > 0) {
      this._applySelection(0);
    }
  }

  _executeSearch(text) {
    if (
      this._selectedIndex >= 0 &&
      this._selectedIndex < this._resultButtons.length
    ) {
      const selectedBtn = this._resultButtons[this._selectedIndex];
      if (selectedBtn._appReference) {
        this._launchApp(selectedBtn._appReference);
        return;
      }
    }

    if (text.trim().length > 0) {
      Gio.app_info_launch_default_for_uri(
        `https://www.google.com/search?q=${encodeURIComponent(text.trim())}`,
        null,
      );
      this._destroySearch();
    }
  }

  _launchApp(appInfo) {
    if (!appInfo) return;

    try {
      const appSystem = Shell.AppSystem.get_default();
      const shellApp = appSystem.lookup_app(appInfo.get_id());

      if (shellApp) {
        shellApp.activate();
      } else {
        appInfo.launch([], null);
      }
    } catch (e) {
      console.error(`Error al lanzar la app: ${e.message}`);
    }

    this._destroySearch();
  }

  _destroySearch() {
    if (this._signals) {
      for (let sig of this._signals) {
        try {
          if (sig.actor && sig.id) {
            sig.actor.disconnect(sig.id);
          }
        } catch (e) {}
      }
      this._signals = null;
    }

    if (this._container) {
      try {
        Main.layoutManager.removeChrome(this._container);
      } catch (e) {}

      try {
        if (this._resultsBin) this._resultsBin.destroy();
      } catch (e) {}
      try {
        if (this._entry) this._entry.destroy();
      } catch (e) {}

      try {
        this._container.destroy();
      } catch (e) {}
    }

    this._container = null;
    this._entry = null;
    this._resultsBin = null;
    this._resultButtons = null;
    this._selectedIndex = null;
  }

  disable() {
    Main.wm.removeKeybinding("my-search-shortcut");
    this._destroySearch();
    this._settings = null;
  }
}
