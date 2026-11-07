import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WorkbenchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({ title: 'Workbench', icon_name: 'system-search-symbolic' });
        const group = new Adw.PreferencesGroup({ title: 'Native desktop panels',
            description: 'PUI uses your selected Papercusp connection. The main GUI can stay closed.' });
        page.add(group); window.add(page);
        const enabled = new Adw.SwitchRow({ title: 'Enable Workbench' });
        settings.bind('enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT); group.add(enabled);
        const pui = new Adw.EntryRow({ title: 'PUI executable' });
        settings.bind('pui-path', pui, 'text', Gio.SettingsBindFlags.DEFAULT); group.add(pui);
        for (const [key, title] of [['quick-access', 'Quick Access shortcut'], ['goals', 'Goals shortcut'], ['inbox', 'Inbox shortcut']]) {
            const entry = new Adw.EntryRow({ title, text: settings.get_strv(key)[0] || '',
                show_apply_button: true });
            entry.connect('apply', () => {
                const value = entry.text.trim();
                const [valid] = Gtk.accelerator_parse(value);
                if (!value || valid) { settings.set_strv(key, value ? [value] : []); entry.remove_css_class('error'); }
                else entry.add_css_class('error');
            });
            group.add(entry);
        }
    }
}
