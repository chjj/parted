var parted = require('../')
  , assert = require('assert')
  , fs = require('fs')
  , path = require('path');

var files = path.normalize(__dirname + '/tmp')
  , image = fs.readFileSync(__dirname + '/top.png');

try {
  fs.readdirSync(files).forEach(function(f) {
    fs.unlink(files + '/' + f);
  });
} catch(e) {
  fs.mkdirSync(files, 0755);
}

parted.multipart.root = files;

// create a mock request
var request = function(size, file) {
  file = __dirname + '/' + file + '.part';

  var stream = fs.createReadStream(file, {
    bufferSize: size
  });

  var boundary = fs
    .readFileSync(file)
    .toString('utf8')
    .match(/--[^\r\n]+/)[0]
    .slice(2);

  return {
    headers: {
      'content-type': 'multipart/form-data; boundary="' + boundary + '"'
    },
    pipe: function(dest) {
      stream.pipe(dest);
    },
    emit: function(ev, err) {
      if (ev === 'error') this.errback && this.errback(err);
      return this;
    },
    on: function(ev, func) {
      if (ev === 'error') this.errback = func;
      return this;
    },
    destroy: function() {
      stream.destroy();
      return this;
    }
  };
};

var handle = parted.multipart.middleware();

var expect_text = {
  chrome: 'world...oh look the end'
              + ' of the part: \r\n------WebKi-just kidding',
  opera: 'oh look the end of the part:\r\n--',
  firefox: 'oh look the end of the part:\r\n--'
};

var message = function(size, file, func) {
  var req = request(size, file)
    , res = {};

  handle(req, res, function(err) {
    if (err) {
      console.log(req.body);
      throw err;
    }

    var parts = req.body;

    console.log('Buffer size:', size);
    console.log(parts);

    assert.ok(!!parts, 'No parts.');
    assert.ok(!!parts.content, 'No file path.');
    assert.ok(parts.text === 'hello',
              'Bad text. Got: ' + parts.text);
    assert.ok(parts.hello === expect_text[file],
              'Bad text. Got: ' + parts.hello);

    var got = fs.readFileSync(parts.content)
      , expect = image
      , i = 0
      , len = expect.length;

    assert.ok(got.length === len,
      'Sizes not equal.'
      + ' Expected: ' + len
      + '. Got: ' + got.length + '.'
    );

    for (; i < len; i++) {
      assert.ok(got[i] === expect[i], 'Diff failure.');
    }

    console.log('Parts parsed successfully.');

    if (func) func();
  });
};

var multiple = function(file, func) {
  var times = 100;

  (function next(i) {
    if (!i) return done();
    message(i, file, function() {
      next(--i);
    });
  })(times);

  function done() {
    console.log('Completed %s, no errors.', file);
    if (func) func();
  }
};

var main = function(argv) {
  multiple('chrome', function() {
    multiple('opera', function() {
      multiple('firefox', function() {
        console.log('DONE - multipart');
        json(true, function() {
          encoded(true, function() {
            json(false);
            encoded(false);
          });
        });
      });
    });
  });
};

var util = require('util');

var inspect = function() {
  return Array.prototype.slice.call(arguments).map(function(arg) {
    return util.inspect(arg);
  }).join('\n');
};

// create a mock request
var _request = function(type) {
  var req = new (require('stream').Stream)();

  req.headers = {
    'content-type': type
  };

  req.destroy = function() {
    return this;
  };

  return req;
};

var json = function(stream, func) {
  var t_json =
  { a: { b: 100, c: [ 2, 3 ] }, d: [ 'e' ],
    f: true, g: null, h: false, i: 1.9,
    j: -1.0, k: false, l: 'hello' };

  var st_json = JSON.stringify(t_json);

  var req = _request('application/json');

  var m = parted({ stream: stream });

  m(req, {}, function(err) {
    if (err) throw err;

    var obj = req.body;
    console.log(obj);
    assert.deepEqual(obj, t_json, 'Not deep equal.');
    assert.equal(JSON.stringify(obj), st_json, 'Not equal.');

    console.log('Completed ' + (stream ? ' streaming ' : '') + 'json.');
    if (stream) func();
  });

  var half = st_json.length / 2 << 0;
  req.emit('data', new Buffer(st_json.slice(0, half), 'utf8'));
  req.emit('data', new Buffer(st_json.slice(half), 'utf8'));
  req.emit('end');
};

var encoded = function(stream, func) {
  var t_encoded =
  { a: '1',
    b: '2',
    c: '3',
    d: 'hello world',
    e: 'hi world',
    f: 'testing',
    g: [ '1', '2', 'asd' ],
    h: { i: 'asdgret34' }
  };

  var st_encoded = stringify(t_encoded);

  var req = _request('application/x-www-form-urlencoded');

  var m = parted({ stream: stream });

  m(req, {}, function(err) {
    if (err) throw err;

    var obj = req.body;
    console.log(obj);
    assert.deepEqual(obj, t_encoded, 'Not deep equal. '
      + inspect(obj, t_encoded, st_encoded));
    assert.equal(stringify(obj), st_encoded, 'Not equal. '
      + stringify(obj));

    console.log('Completed '
      + (stream ? ' streaming ' : '') + 'encoded.');

    if (stream) func();
  });

  var half = st_encoded.length / 2 << 0;
  req.emit('data', new Buffer(st_encoded.slice(0, half), 'utf8'));
  req.emit('data', new Buffer(st_encoded.slice(half), 'utf8'));
  req.emit('end')
};

// from node-querystring
var stringify = (function() {
  function stringifyString(str, prefix) {
    if (!prefix) throw new TypeError('stringify expects an object');
    return prefix + '=' + encodeURIComponent(str);
  }

  function stringifyArray(arr, prefix) {
    var ret = [];
    if (!prefix) throw new TypeError('stringify expects an object');
    for (var i = 0; i < arr.length; i++) {
      ret.push(stringify(arr[i], prefix + '[]'));
    }
    return ret.join('&');
  }

  function stringifyObject(obj, prefix) {
    var ret = []
      , keys = Object.keys(obj)
      , key;
    for (var i = 0, len = keys.length; i < len; ++i) {
      key = keys[i];
      ret.push(stringify(obj[key], prefix
        ? prefix + '[' + encodeURIComponent(key) + ']'
        : encodeURIComponent(key)));
    }
    return ret.join('&');
  }

  return function(obj, prefix) {
    if (Array.isArray(obj)) {
      return stringifyArray(obj, prefix);
    } else if ('[object Object]' == toString.call(obj)) {
      return stringifyObject(obj, prefix);
    } else if ('string' == typeof obj) {
      return stringifyString(obj, prefix);
    } else {
      return prefix;
    }
  };
})();

main(process.argv.slice(2));
