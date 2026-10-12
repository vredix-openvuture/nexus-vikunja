// Bundled for test/board.html: the REAL suite kanban plus this plugin's source.
require('../../nexus-suite/test/dom-ext.js');
window.kanbanLib = require('../../nexus-suite/src/lib/kanban.js');
window.vikunjaSource = require('../src/source.js').vikunjaSource;
window.openTaskNote = require('../src/tasknotes.js').openTaskNote;
window.BoardStore = require('../src/store.js').BoardStore;
window.VikunjaClient = require('../src/client.js').VikunjaClient;
window.fakeVikunja = require('./fakeserver.js').fakeVikunja;
window.obsidianStub = require('obsidian');
