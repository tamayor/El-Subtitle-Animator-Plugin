// Blackmagic's Workflow Integration native addon (copied next to manifest.xml by the installer).

const { WORKFLOW_INTEGRATION_NODE } = require('./config');

module.exports = require(WORKFLOW_INTEGRATION_NODE);
