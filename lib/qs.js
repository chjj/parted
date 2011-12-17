/**
 * Buffering Encoded
 */

var qs = function(str, del, eq) {
  if (!str) return {};

  var out = {}
    , s = str.split(del || '&')
    , l = s.length
    , i = 0
    , $;

  for (; i < l; i++) {
    $ = s[i].split(eq || '=');
    if ($[0]) {
      $[0] = unescape($[0]);
      $[1] = $[1] ? unescape($[1]) : '';
      set(out, $[0], $[1]);
    }
  }

  return out;
};

var unescape = function(str) {
  try {
    str = decodeURIComponent(str).replace(/\+/g, ' ');
  } finally {
    return str.replace(/\0/g, '');
  }
};

/**
 * Nested Fields
 */

var set = function(parts, field, part) {
  var obj = parts
    , name = field.split('[')
    , field = name[0]
    , l = name.length
    , i = 1
    , key;

  for (; i < l; i++) {
    key = name[i].slice(0, -1);

    if (!obj[field]) {
      obj[field] = /^$|^\d+$/.test(key)
        ? []
        : {};
    }

    obj = obj[field];

    field = !key && Array.isArray(obj)
      ? obj.length
      : key;
  }

  if (Array.isArray(obj[field])) {
    obj[field].push(part);
  } else if (obj[field]) {
    obj[field] = [obj[field], part];
  } else {
    obj[field] = part;
  }
};

/**
 * Expose
 */

exports = qs;

exports.parse = qs;
exports.set = set;
exports.unescape = unescape;

module.exports = exports;
