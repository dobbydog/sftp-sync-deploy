require('colors');

function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function chomp(str, char) {
  return str.replace(new RegExp(escapeRegExp(char) + '+$'), '');
}

function normalizedRelativePath(pathStr, root) {
  let relative = pathStr.replace(new RegExp(escapeRegExp(root)), '').replace(/\\/g, '/');

  return relative === '' ? '(root dir)' : relative.substr(1);
}

/**
 * Get a task by stats
 * @param {Object} stats
 * @return {string[]}
 */
function getTask(stats) {
  let task = {method: undefined, removeRemote: false};

  if (!stats.local || (stats.remote && stats.local !== stats.remote)) {
    task.removeRemote = true;
  }

  if (!stats.remote || stats.local === 'file' || stats.local === 'dir' && stats.remote === 'file') {
    task.method = 'upload';
  } else if (stats.local === 'dir') {
    task.method = 'sync';
  } else {
    task.method = 'noop';
  }

  return task;
}

/**
 * Get a colored label string by stat
 * @param {Object} stat
 * @return {string}
 */
function label(stat) {
  return stat === 'dir' ? 'D'.cyan : (stat === 'file' ? 'F'.yellow : 'X'.gray);
}

exports.escapeRegExp = escapeRegExp;
exports.chomp = chomp;
exports.normalizedRelativePath = normalizedRelativePath;
exports.getTask = getTask;
exports.label = label;
