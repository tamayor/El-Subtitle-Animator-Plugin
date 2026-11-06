// Blackmagic's Workflow Integration native addon (copied next to manifest.xml by install.command).

const { WORKFLOW_INTEGRATION_NODE } = require('./config');

module.exports = require(WORKFLOW_INTEGRATION_NODE);
