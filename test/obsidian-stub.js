'use strict';
/* Just enough of the obsidian module for the plugin's logic to run in node.
   requestUrl is routed to whatever fake server a test installs. */
class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); this.extension = 'md'; } }
const notices = [];
class Notice { constructor(text) { notices.push(text); } }
module.exports = {
  TFile, Notice, notices,
  requestUrl: async (o) => {
    if (!global.__server) throw new Error('no fake server');
    return global.__server(o);
  },
  normalizePath: (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
  setIcon() {}, Menu: class { addItem() { return this; } addSeparator() {} showAtMouseEvent() {} },
  Plugin: class {}, Modal: class {}, Setting: class {}, PluginSettingTab: class {},
};
