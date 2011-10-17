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

parted.root = files;

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

var handle = parted.middleware();

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
  if (!argv.length || ~argv.indexOf('--multipart')) {
    multiple('chrome', function() {
      multiple('opera', function() {
        multiple('firefox', function() {
          console.log('DONE');
        });
      });
    });
  }

  if (~argv.indexOf('--json')) {
    json();
  }

  if (~argv.indexOf('--encoded')) {
    encoded();
  }
};

var json = function() {
  var assert = require('assert');
  var TEST_JSON = '{"a":{"b":100,"c":[2,3]},"d":["e"],"f":true}';
  var Parser = require('../lib/json');

  var parser = Parser.create();

  parser.on('end', function(obj) {
    console.log(obj);
    assert.deepEqual(obj, JSON.parse(TEST_JSON), 'Not deep equal.');
    assert.equal(JSON.stringify(obj), TEST_JSON, 'Not equal.');
    console.log('Completed.');
  });

  var emit = parser.emit;
  parser.emit = function(type, val) {
    console.log(type, val);
    return emit.apply(this, arguments);
  };

  parser.write(TEST_JSON.slice(0, 25));
  parser.write(TEST_JSON.slice(25));
  parser.end();

  /*
  (function emit(a, b) {
    parser.emit(a, b);
    return emit;
  })
  ('object start')
  ('object key', 'hello')
  ('object start')
  ('object key', 'world')
  ('number', 100)
  ('object key', 'test')
  ('array start')
  ('number', 2)
  ('number', 3)
  ('array end')
  ('object end')
  ('object key', 'hi')
  ('array start')
  ('string', 'an array!')
  ('array end')
  ('object end')
  ('end', parser.data);
  */
};

var encoded = function() {
  var assert = require('assert')
    , qs = require('querystring')
    , obj = {}
    , Parser = require('../lib/encoded');

  var TEST_ENCODED = 'a=1&b=2&c=3&d=hello%20world&e=hi%20world&f=testing';

  var parser = new Parser();

  parser.on('value', function(key, value) {
    console.log(key, value);
    obj[key] = value;
  });

  parser.on('end', function() {
    console.log(obj);
    assert.deepEqual(obj, qs.parse(TEST_ENCODED), 'Not deep equal.'
      + require('util').inspect(qs.parse(TEST_ENCODED)));
    assert.equal(qs.stringify(obj), TEST_ENCODED, 'Not equal.'
      + qs.stringify(obj));
    console.log('Completed.');
  });

  parser.write(new Buffer(TEST_ENCODED.slice(0, 25), 'utf8'));
  parser.write(new Buffer(TEST_ENCODED.slice(25), 'utf8'));
  parser.end();
};

main(process.argv.slice(2));
