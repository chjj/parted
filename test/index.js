var parted = require('../')
  , qs = parted.qs
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
          djson(function() {
            encoded(true, function() {
              json(false);
              encoded(false);
            });
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

var djson = function(func) {
  var t_json =
  { a: { b: 100, c: [ 2, 3 ] }, d: [ 'e' ],
    f: true, g: null, h: false, i: 1.9,
    j: -1.0, k: false, l: 'hello' };

  var st_json = JSON.stringify(t_json);

  st_json += '\n' + st_json;
  st_json += '\n3\n{}';

  var req = _request('application/json');

  var m = parted({ stream: true, noMultiple: false });

  m(req, {}, function(err) {
    if (err) throw err;

    var obj = req.body;
    console.log(obj);
    assert.equal(obj.length, 4);

    obj.slice(0, 2).forEach(function(obj) {
      assert.deepEqual(obj, t_json, 'Not deep equal.');
      assert.equal(JSON.stringify(obj), st_json.split('\n')[0], 'Not equal.');
    });

    assert.equal(obj[2], 3);

    assert.deepEqual(obj[3], {});
    assert.equal(JSON.stringify(obj[3]), '{}');

    console.log('Completed double streaming json.');
    func();
  });

  var third = st_json.length / 3 | 0;
  req.emit('data', new Buffer(st_json.slice(0, third), 'utf8'));
  req.emit('data', new Buffer(st_json.slice(third, third * 2), 'utf8'));
  req.emit('data', new Buffer(st_json.slice(third * 2), 'utf8'));
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

  var st_encoded_ = 'a=1&b=2&c=3&d=hello+world&e=hi+world'
    + '&f=testing&g[]=1&g[]=2&g[]=asd&h[i]=asdgret34';

  var st_encoded = qs.stringify(t_encoded);

  assert.equal(st_encoded, st_encoded_);

  var req = _request('application/x-www-form-urlencoded');

  var m = parted({ stream: stream });

  m(req, {}, function(err) {
    if (err) throw err;

    var obj = req.body;
    console.log(obj);
    assert.deepEqual(obj, t_encoded, 'Not deep equal. '
      + inspect(obj, t_encoded, st_encoded));
    assert.equal(qs.stringify(obj), st_encoded, 'Not equal. '
      + qs.stringify(obj));

    console.log('Completed '
      + (stream ? ' streaming ' : '') + 'encoded.');

    if (stream) func();
  });

  var half = st_encoded.length / 2 << 0;
  req.emit('data', new Buffer(st_encoded.slice(0, half), 'utf8'));
  req.emit('data', new Buffer(st_encoded.slice(half), 'utf8'));
  req.emit('end')
};

main(process.argv.slice(2));
