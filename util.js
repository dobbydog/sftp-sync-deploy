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

exports.escapeRegExp = escapeRegExp;
exports.chomp = chomp;
exports.normalizedRelativePath = normalizedRelativePath;
