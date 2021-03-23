var WebVoiceProcessor = (function (exports) {
	'use strict';

	function createCommonjsModule(fn) {
	  var module = { exports: {} };
		return fn(module, module.exports), module.exports;
	}

	/**
	 * Copyright (c) 2014-present, Facebook, Inc.
	 *
	 * This source code is licensed under the MIT license found in the
	 * LICENSE file in the root directory of this source tree.
	 */

	var runtime_1 = createCommonjsModule(function (module) {
	var runtime = (function (exports) {

	  var Op = Object.prototype;
	  var hasOwn = Op.hasOwnProperty;
	  var undefined$1; // More compressible than void 0.
	  var $Symbol = typeof Symbol === "function" ? Symbol : {};
	  var iteratorSymbol = $Symbol.iterator || "@@iterator";
	  var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
	  var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

	  function define(obj, key, value) {
	    Object.defineProperty(obj, key, {
	      value: value,
	      enumerable: true,
	      configurable: true,
	      writable: true
	    });
	    return obj[key];
	  }
	  try {
	    // IE 8 has a broken Object.defineProperty that only works on DOM objects.
	    define({}, "");
	  } catch (err) {
	    define = function(obj, key, value) {
	      return obj[key] = value;
	    };
	  }

	  function wrap(innerFn, outerFn, self, tryLocsList) {
	    // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
	    var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
	    var generator = Object.create(protoGenerator.prototype);
	    var context = new Context(tryLocsList || []);

	    // The ._invoke method unifies the implementations of the .next,
	    // .throw, and .return methods.
	    generator._invoke = makeInvokeMethod(innerFn, self, context);

	    return generator;
	  }
	  exports.wrap = wrap;

	  // Try/catch helper to minimize deoptimizations. Returns a completion
	  // record like context.tryEntries[i].completion. This interface could
	  // have been (and was previously) designed to take a closure to be
	  // invoked without arguments, but in all the cases we care about we
	  // already have an existing method we want to call, so there's no need
	  // to create a new function object. We can even get away with assuming
	  // the method takes exactly one argument, since that happens to be true
	  // in every case, so we don't have to touch the arguments object. The
	  // only additional allocation required is the completion record, which
	  // has a stable shape and so hopefully should be cheap to allocate.
	  function tryCatch(fn, obj, arg) {
	    try {
	      return { type: "normal", arg: fn.call(obj, arg) };
	    } catch (err) {
	      return { type: "throw", arg: err };
	    }
	  }

	  var GenStateSuspendedStart = "suspendedStart";
	  var GenStateSuspendedYield = "suspendedYield";
	  var GenStateExecuting = "executing";
	  var GenStateCompleted = "completed";

	  // Returning this object from the innerFn has the same effect as
	  // breaking out of the dispatch switch statement.
	  var ContinueSentinel = {};

	  // Dummy constructor functions that we use as the .constructor and
	  // .constructor.prototype properties for functions that return Generator
	  // objects. For full spec compliance, you may wish to configure your
	  // minifier not to mangle the names of these two functions.
	  function Generator() {}
	  function GeneratorFunction() {}
	  function GeneratorFunctionPrototype() {}

	  // This is a polyfill for %IteratorPrototype% for environments that
	  // don't natively support it.
	  var IteratorPrototype = {};
	  IteratorPrototype[iteratorSymbol] = function () {
	    return this;
	  };

	  var getProto = Object.getPrototypeOf;
	  var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
	  if (NativeIteratorPrototype &&
	      NativeIteratorPrototype !== Op &&
	      hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
	    // This environment has a native %IteratorPrototype%; use it instead
	    // of the polyfill.
	    IteratorPrototype = NativeIteratorPrototype;
	  }

	  var Gp = GeneratorFunctionPrototype.prototype =
	    Generator.prototype = Object.create(IteratorPrototype);
	  GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
	  GeneratorFunctionPrototype.constructor = GeneratorFunction;
	  GeneratorFunction.displayName = define(
	    GeneratorFunctionPrototype,
	    toStringTagSymbol,
	    "GeneratorFunction"
	  );

	  // Helper for defining the .next, .throw, and .return methods of the
	  // Iterator interface in terms of a single ._invoke method.
	  function defineIteratorMethods(prototype) {
	    ["next", "throw", "return"].forEach(function(method) {
	      define(prototype, method, function(arg) {
	        return this._invoke(method, arg);
	      });
	    });
	  }

	  exports.isGeneratorFunction = function(genFun) {
	    var ctor = typeof genFun === "function" && genFun.constructor;
	    return ctor
	      ? ctor === GeneratorFunction ||
	        // For the native GeneratorFunction constructor, the best we can
	        // do is to check its .name property.
	        (ctor.displayName || ctor.name) === "GeneratorFunction"
	      : false;
	  };

	  exports.mark = function(genFun) {
	    if (Object.setPrototypeOf) {
	      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
	    } else {
	      genFun.__proto__ = GeneratorFunctionPrototype;
	      define(genFun, toStringTagSymbol, "GeneratorFunction");
	    }
	    genFun.prototype = Object.create(Gp);
	    return genFun;
	  };

	  // Within the body of any async function, `await x` is transformed to
	  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
	  // `hasOwn.call(value, "__await")` to determine if the yielded value is
	  // meant to be awaited.
	  exports.awrap = function(arg) {
	    return { __await: arg };
	  };

	  function AsyncIterator(generator, PromiseImpl) {
	    function invoke(method, arg, resolve, reject) {
	      var record = tryCatch(generator[method], generator, arg);
	      if (record.type === "throw") {
	        reject(record.arg);
	      } else {
	        var result = record.arg;
	        var value = result.value;
	        if (value &&
	            typeof value === "object" &&
	            hasOwn.call(value, "__await")) {
	          return PromiseImpl.resolve(value.__await).then(function(value) {
	            invoke("next", value, resolve, reject);
	          }, function(err) {
	            invoke("throw", err, resolve, reject);
	          });
	        }

	        return PromiseImpl.resolve(value).then(function(unwrapped) {
	          // When a yielded Promise is resolved, its final value becomes
	          // the .value of the Promise<{value,done}> result for the
	          // current iteration.
	          result.value = unwrapped;
	          resolve(result);
	        }, function(error) {
	          // If a rejected Promise was yielded, throw the rejection back
	          // into the async generator function so it can be handled there.
	          return invoke("throw", error, resolve, reject);
	        });
	      }
	    }

	    var previousPromise;

	    function enqueue(method, arg) {
	      function callInvokeWithMethodAndArg() {
	        return new PromiseImpl(function(resolve, reject) {
	          invoke(method, arg, resolve, reject);
	        });
	      }

	      return previousPromise =
	        // If enqueue has been called before, then we want to wait until
	        // all previous Promises have been resolved before calling invoke,
	        // so that results are always delivered in the correct order. If
	        // enqueue has not been called before, then it is important to
	        // call invoke immediately, without waiting on a callback to fire,
	        // so that the async generator function has the opportunity to do
	        // any necessary setup in a predictable way. This predictability
	        // is why the Promise constructor synchronously invokes its
	        // executor callback, and why async functions synchronously
	        // execute code before the first await. Since we implement simple
	        // async functions in terms of async generators, it is especially
	        // important to get this right, even though it requires care.
	        previousPromise ? previousPromise.then(
	          callInvokeWithMethodAndArg,
	          // Avoid propagating failures to Promises returned by later
	          // invocations of the iterator.
	          callInvokeWithMethodAndArg
	        ) : callInvokeWithMethodAndArg();
	    }

	    // Define the unified helper method that is used to implement .next,
	    // .throw, and .return (see defineIteratorMethods).
	    this._invoke = enqueue;
	  }

	  defineIteratorMethods(AsyncIterator.prototype);
	  AsyncIterator.prototype[asyncIteratorSymbol] = function () {
	    return this;
	  };
	  exports.AsyncIterator = AsyncIterator;

	  // Note that simple async functions are implemented on top of
	  // AsyncIterator objects; they just return a Promise for the value of
	  // the final result produced by the iterator.
	  exports.async = function(innerFn, outerFn, self, tryLocsList, PromiseImpl) {
	    if (PromiseImpl === void 0) PromiseImpl = Promise;

	    var iter = new AsyncIterator(
	      wrap(innerFn, outerFn, self, tryLocsList),
	      PromiseImpl
	    );

	    return exports.isGeneratorFunction(outerFn)
	      ? iter // If outerFn is a generator, return the full iterator.
	      : iter.next().then(function(result) {
	          return result.done ? result.value : iter.next();
	        });
	  };

	  function makeInvokeMethod(innerFn, self, context) {
	    var state = GenStateSuspendedStart;

	    return function invoke(method, arg) {
	      if (state === GenStateExecuting) {
	        throw new Error("Generator is already running");
	      }

	      if (state === GenStateCompleted) {
	        if (method === "throw") {
	          throw arg;
	        }

	        // Be forgiving, per 25.3.3.3.3 of the spec:
	        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
	        return doneResult();
	      }

	      context.method = method;
	      context.arg = arg;

	      while (true) {
	        var delegate = context.delegate;
	        if (delegate) {
	          var delegateResult = maybeInvokeDelegate(delegate, context);
	          if (delegateResult) {
	            if (delegateResult === ContinueSentinel) continue;
	            return delegateResult;
	          }
	        }

	        if (context.method === "next") {
	          // Setting context._sent for legacy support of Babel's
	          // function.sent implementation.
	          context.sent = context._sent = context.arg;

	        } else if (context.method === "throw") {
	          if (state === GenStateSuspendedStart) {
	            state = GenStateCompleted;
	            throw context.arg;
	          }

	          context.dispatchException(context.arg);

	        } else if (context.method === "return") {
	          context.abrupt("return", context.arg);
	        }

	        state = GenStateExecuting;

	        var record = tryCatch(innerFn, self, context);
	        if (record.type === "normal") {
	          // If an exception is thrown from innerFn, we leave state ===
	          // GenStateExecuting and loop back for another invocation.
	          state = context.done
	            ? GenStateCompleted
	            : GenStateSuspendedYield;

	          if (record.arg === ContinueSentinel) {
	            continue;
	          }

	          return {
	            value: record.arg,
	            done: context.done
	          };

	        } else if (record.type === "throw") {
	          state = GenStateCompleted;
	          // Dispatch the exception by looping back around to the
	          // context.dispatchException(context.arg) call above.
	          context.method = "throw";
	          context.arg = record.arg;
	        }
	      }
	    };
	  }

	  // Call delegate.iterator[context.method](context.arg) and handle the
	  // result, either by returning a { value, done } result from the
	  // delegate iterator, or by modifying context.method and context.arg,
	  // setting context.delegate to null, and returning the ContinueSentinel.
	  function maybeInvokeDelegate(delegate, context) {
	    var method = delegate.iterator[context.method];
	    if (method === undefined$1) {
	      // A .throw or .return when the delegate iterator has no .throw
	      // method always terminates the yield* loop.
	      context.delegate = null;

	      if (context.method === "throw") {
	        // Note: ["return"] must be used for ES3 parsing compatibility.
	        if (delegate.iterator["return"]) {
	          // If the delegate iterator has a return method, give it a
	          // chance to clean up.
	          context.method = "return";
	          context.arg = undefined$1;
	          maybeInvokeDelegate(delegate, context);

	          if (context.method === "throw") {
	            // If maybeInvokeDelegate(context) changed context.method from
	            // "return" to "throw", let that override the TypeError below.
	            return ContinueSentinel;
	          }
	        }

	        context.method = "throw";
	        context.arg = new TypeError(
	          "The iterator does not provide a 'throw' method");
	      }

	      return ContinueSentinel;
	    }

	    var record = tryCatch(method, delegate.iterator, context.arg);

	    if (record.type === "throw") {
	      context.method = "throw";
	      context.arg = record.arg;
	      context.delegate = null;
	      return ContinueSentinel;
	    }

	    var info = record.arg;

	    if (! info) {
	      context.method = "throw";
	      context.arg = new TypeError("iterator result is not an object");
	      context.delegate = null;
	      return ContinueSentinel;
	    }

	    if (info.done) {
	      // Assign the result of the finished delegate to the temporary
	      // variable specified by delegate.resultName (see delegateYield).
	      context[delegate.resultName] = info.value;

	      // Resume execution at the desired location (see delegateYield).
	      context.next = delegate.nextLoc;

	      // If context.method was "throw" but the delegate handled the
	      // exception, let the outer generator proceed normally. If
	      // context.method was "next", forget context.arg since it has been
	      // "consumed" by the delegate iterator. If context.method was
	      // "return", allow the original .return call to continue in the
	      // outer generator.
	      if (context.method !== "return") {
	        context.method = "next";
	        context.arg = undefined$1;
	      }

	    } else {
	      // Re-yield the result returned by the delegate method.
	      return info;
	    }

	    // The delegate iterator is finished, so forget it and continue with
	    // the outer generator.
	    context.delegate = null;
	    return ContinueSentinel;
	  }

	  // Define Generator.prototype.{next,throw,return} in terms of the
	  // unified ._invoke helper method.
	  defineIteratorMethods(Gp);

	  define(Gp, toStringTagSymbol, "Generator");

	  // A Generator should always return itself as the iterator object when the
	  // @@iterator function is called on it. Some browsers' implementations of the
	  // iterator prototype chain incorrectly implement this, causing the Generator
	  // object to not be returned from this call. This ensures that doesn't happen.
	  // See https://github.com/facebook/regenerator/issues/274 for more details.
	  Gp[iteratorSymbol] = function() {
	    return this;
	  };

	  Gp.toString = function() {
	    return "[object Generator]";
	  };

	  function pushTryEntry(locs) {
	    var entry = { tryLoc: locs[0] };

	    if (1 in locs) {
	      entry.catchLoc = locs[1];
	    }

	    if (2 in locs) {
	      entry.finallyLoc = locs[2];
	      entry.afterLoc = locs[3];
	    }

	    this.tryEntries.push(entry);
	  }

	  function resetTryEntry(entry) {
	    var record = entry.completion || {};
	    record.type = "normal";
	    delete record.arg;
	    entry.completion = record;
	  }

	  function Context(tryLocsList) {
	    // The root entry object (effectively a try statement without a catch
	    // or a finally block) gives us a place to store values thrown from
	    // locations where there is no enclosing try statement.
	    this.tryEntries = [{ tryLoc: "root" }];
	    tryLocsList.forEach(pushTryEntry, this);
	    this.reset(true);
	  }

	  exports.keys = function(object) {
	    var keys = [];
	    for (var key in object) {
	      keys.push(key);
	    }
	    keys.reverse();

	    // Rather than returning an object with a next method, we keep
	    // things simple and return the next function itself.
	    return function next() {
	      while (keys.length) {
	        var key = keys.pop();
	        if (key in object) {
	          next.value = key;
	          next.done = false;
	          return next;
	        }
	      }

	      // To avoid creating an additional object, we just hang the .value
	      // and .done properties off the next function object itself. This
	      // also ensures that the minifier will not anonymize the function.
	      next.done = true;
	      return next;
	    };
	  };

	  function values(iterable) {
	    if (iterable) {
	      var iteratorMethod = iterable[iteratorSymbol];
	      if (iteratorMethod) {
	        return iteratorMethod.call(iterable);
	      }

	      if (typeof iterable.next === "function") {
	        return iterable;
	      }

	      if (!isNaN(iterable.length)) {
	        var i = -1, next = function next() {
	          while (++i < iterable.length) {
	            if (hasOwn.call(iterable, i)) {
	              next.value = iterable[i];
	              next.done = false;
	              return next;
	            }
	          }

	          next.value = undefined$1;
	          next.done = true;

	          return next;
	        };

	        return next.next = next;
	      }
	    }

	    // Return an iterator with no values.
	    return { next: doneResult };
	  }
	  exports.values = values;

	  function doneResult() {
	    return { value: undefined$1, done: true };
	  }

	  Context.prototype = {
	    constructor: Context,

	    reset: function(skipTempReset) {
	      this.prev = 0;
	      this.next = 0;
	      // Resetting context._sent for legacy support of Babel's
	      // function.sent implementation.
	      this.sent = this._sent = undefined$1;
	      this.done = false;
	      this.delegate = null;

	      this.method = "next";
	      this.arg = undefined$1;

	      this.tryEntries.forEach(resetTryEntry);

	      if (!skipTempReset) {
	        for (var name in this) {
	          // Not sure about the optimal order of these conditions:
	          if (name.charAt(0) === "t" &&
	              hasOwn.call(this, name) &&
	              !isNaN(+name.slice(1))) {
	            this[name] = undefined$1;
	          }
	        }
	      }
	    },

	    stop: function() {
	      this.done = true;

	      var rootEntry = this.tryEntries[0];
	      var rootRecord = rootEntry.completion;
	      if (rootRecord.type === "throw") {
	        throw rootRecord.arg;
	      }

	      return this.rval;
	    },

	    dispatchException: function(exception) {
	      if (this.done) {
	        throw exception;
	      }

	      var context = this;
	      function handle(loc, caught) {
	        record.type = "throw";
	        record.arg = exception;
	        context.next = loc;

	        if (caught) {
	          // If the dispatched exception was caught by a catch block,
	          // then let that catch block handle the exception normally.
	          context.method = "next";
	          context.arg = undefined$1;
	        }

	        return !! caught;
	      }

	      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
	        var entry = this.tryEntries[i];
	        var record = entry.completion;

	        if (entry.tryLoc === "root") {
	          // Exception thrown outside of any try block that could handle
	          // it, so set the completion value of the entire function to
	          // throw the exception.
	          return handle("end");
	        }

	        if (entry.tryLoc <= this.prev) {
	          var hasCatch = hasOwn.call(entry, "catchLoc");
	          var hasFinally = hasOwn.call(entry, "finallyLoc");

	          if (hasCatch && hasFinally) {
	            if (this.prev < entry.catchLoc) {
	              return handle(entry.catchLoc, true);
	            } else if (this.prev < entry.finallyLoc) {
	              return handle(entry.finallyLoc);
	            }

	          } else if (hasCatch) {
	            if (this.prev < entry.catchLoc) {
	              return handle(entry.catchLoc, true);
	            }

	          } else if (hasFinally) {
	            if (this.prev < entry.finallyLoc) {
	              return handle(entry.finallyLoc);
	            }

	          } else {
	            throw new Error("try statement without catch or finally");
	          }
	        }
	      }
	    },

	    abrupt: function(type, arg) {
	      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
	        var entry = this.tryEntries[i];
	        if (entry.tryLoc <= this.prev &&
	            hasOwn.call(entry, "finallyLoc") &&
	            this.prev < entry.finallyLoc) {
	          var finallyEntry = entry;
	          break;
	        }
	      }

	      if (finallyEntry &&
	          (type === "break" ||
	           type === "continue") &&
	          finallyEntry.tryLoc <= arg &&
	          arg <= finallyEntry.finallyLoc) {
	        // Ignore the finally entry if control is not jumping to a
	        // location outside the try/catch block.
	        finallyEntry = null;
	      }

	      var record = finallyEntry ? finallyEntry.completion : {};
	      record.type = type;
	      record.arg = arg;

	      if (finallyEntry) {
	        this.method = "next";
	        this.next = finallyEntry.finallyLoc;
	        return ContinueSentinel;
	      }

	      return this.complete(record);
	    },

	    complete: function(record, afterLoc) {
	      if (record.type === "throw") {
	        throw record.arg;
	      }

	      if (record.type === "break" ||
	          record.type === "continue") {
	        this.next = record.arg;
	      } else if (record.type === "return") {
	        this.rval = this.arg = record.arg;
	        this.method = "return";
	        this.next = "end";
	      } else if (record.type === "normal" && afterLoc) {
	        this.next = afterLoc;
	      }

	      return ContinueSentinel;
	    },

	    finish: function(finallyLoc) {
	      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
	        var entry = this.tryEntries[i];
	        if (entry.finallyLoc === finallyLoc) {
	          this.complete(entry.completion, entry.afterLoc);
	          resetTryEntry(entry);
	          return ContinueSentinel;
	        }
	      }
	    },

	    "catch": function(tryLoc) {
	      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
	        var entry = this.tryEntries[i];
	        if (entry.tryLoc === tryLoc) {
	          var record = entry.completion;
	          if (record.type === "throw") {
	            var thrown = record.arg;
	            resetTryEntry(entry);
	          }
	          return thrown;
	        }
	      }

	      // The context.catch method must only be called with a location
	      // argument that corresponds to a known catch block.
	      throw new Error("illegal catch attempt");
	    },

	    delegateYield: function(iterable, resultName, nextLoc) {
	      this.delegate = {
	        iterator: values(iterable),
	        resultName: resultName,
	        nextLoc: nextLoc
	      };

	      if (this.method === "next") {
	        // Deliberately forget the last sent value so that we don't
	        // accidentally pass it on to the delegate.
	        this.arg = undefined$1;
	      }

	      return ContinueSentinel;
	    }
	  };

	  // Regardless of whether this script is executing as a CommonJS module
	  // or not, return the runtime object so that we can declare the variable
	  // regeneratorRuntime in the outer scope, which allows this module to be
	  // injected easily by `bin/regenerator --include-runtime script.js`.
	  return exports;

	}(
	  // If this script is executing as a CommonJS module, use module.exports
	  // as the regeneratorRuntime namespace. Otherwise create a new empty
	  // object. Either way, the resulting object will be used to initialize
	  // the regeneratorRuntime variable at the top of this file.
	  module.exports 
	));

	try {
	  regeneratorRuntime = runtime;
	} catch (accidentalStrictMode) {
	  // This module should not be running in strict mode, so the above
	  // assignment should always work unless something is misconfigured. Just
	  // in case runtime.js accidentally runs in strict mode, we can escape
	  // strict mode using a global Function call. This could conceivably fail
	  // if a Content Security Policy forbids using Function, but in that case
	  // the proper solution is to fix the accidental strict mode problem. If
	  // you've misconfigured your bundler to force strict mode and applied a
	  // CSP to forbid Function, and you're not willing to fix either of those
	  // problems, please detail your unique predicament in a GitHub issue.
	  Function("r", "regeneratorRuntime = r")(runtime);
	}
	});

	var regenerator = runtime_1;

	function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
	  try {
	    var info = gen[key](arg);
	    var value = info.value;
	  } catch (error) {
	    reject(error);
	    return;
	  }

	  if (info.done) {
	    resolve(value);
	  } else {
	    Promise.resolve(value).then(_next, _throw);
	  }
	}

	function _asyncToGenerator(fn) {
	  return function () {
	    var self = this,
	        args = arguments;
	    return new Promise(function (resolve, reject) {
	      var gen = fn.apply(self, args);

	      function _next(value) {
	        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
	      }

	      function _throw(err) {
	        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
	      }

	      _next(undefined);
	    });
	  };
	}

	var asyncToGenerator = _asyncToGenerator;

	function _classCallCheck(instance, Constructor) {
	  if (!(instance instanceof Constructor)) {
	    throw new TypeError("Cannot call a class as a function");
	  }
	}

	var classCallCheck = _classCallCheck;

	function _defineProperties(target, props) {
	  for (var i = 0; i < props.length; i++) {
	    var descriptor = props[i];
	    descriptor.enumerable = descriptor.enumerable || false;
	    descriptor.configurable = true;
	    if ("value" in descriptor) descriptor.writable = true;
	    Object.defineProperty(target, descriptor.key, descriptor);
	  }
	}

	function _createClass(Constructor, protoProps, staticProps) {
	  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
	  if (staticProps) _defineProperties(Constructor, staticProps);
	  return Constructor;
	}

	var createClass = _createClass;

	function decodeBase64(base64, enableUnicode) {
	    var binaryString = atob(base64);
	    if (enableUnicode) {
	        var binaryView = new Uint8Array(binaryString.length);
	        for (var i = 0, n = binaryString.length; i < n; ++i) {
	            binaryView[i] = binaryString.charCodeAt(i);
	        }
	        return String.fromCharCode.apply(null, new Uint16Array(binaryView.buffer));
	    }
	    return binaryString;
	}

	function createURL(base64, sourcemapArg, enableUnicodeArg) {
	    var sourcemap = sourcemapArg === undefined ? null : sourcemapArg;
	    var enableUnicode = enableUnicodeArg === undefined ? false : enableUnicodeArg;
	    var source = decodeBase64(base64, enableUnicode);
	    var start = source.indexOf('\n', 10) + 1;
	    var body = source.substring(start) + (sourcemap ? '\/\/# sourceMappingURL=' + sourcemap : '');
	    var blob = new Blob([body], { type: 'application/javascript' });
	    return URL.createObjectURL(blob);
	}

	function createBase64WorkerFactory(base64, sourcemapArg, enableUnicodeArg) {
	    var url;
	    return function WorkerFactory(options) {
	        url = url || createURL(base64, sourcemapArg, enableUnicodeArg);
	        return new Worker(url, options);
	    };
	}

	var WorkerFactory = createBase64WorkerFactory('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2VyLWxvYWRlciAqLwooZnVuY3Rpb24gKCkgewogICd1c2Ugc3RyaWN0JzsKCiAgLyoNCiAgICAgIENvcHlyaWdodCAyMDE4LTIwMjEgUGljb3ZvaWNlIEluYy4NCgogICAgICBZb3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIGxpY2Vuc2UuIEEgY29weSBvZiB0aGUgbGljZW5zZSBpcyBsb2NhdGVkIGluIHRoZSAiTElDRU5TRSINCiAgICAgIGZpbGUgYWNjb21wYW55aW5nIHRoaXMgc291cmNlLg0KCiAgICAgIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmUgZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24NCiAgICAgIGFuICJBUyBJUyIgQkFTSVMsIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZQ0KICAgICAgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZCBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS4NCiAgKi8KICB2YXIgUFZfRlJBTUVfTEVOR1RIID0gNTEyOwogIHZhciBQVl9TQU1QTEVfUkFURSA9IDE2MDAwOwogIHZhciBTX0lOVDE2X01BWCA9IDMyNzY3OwoKICB2YXIgX2lucHV0U2FtcGxlUmF0ZTsKCiAgdmFyIF9vdXRwdXRTYW1wbGVSYXRlOwoKICB2YXIgX2ZyYW1lTGVuZ3RoOwoKICB2YXIgX2lucHV0QnVmZmVyID0gW107CgogIHZhciBfYXVkaW9EdW1wQWN0aXZlOwoKICB2YXIgX2F1ZGlvRHVtcEJ1ZmZlcjsKCiAgdmFyIF9hdWRpb0R1bXBCdWZmZXJJbmRleDsKCiAgdmFyIF9hdWRpb0R1bXBOdW1GcmFtZXM7CgogIGZ1bmN0aW9uIGluaXQoaW5wdXRTYW1wbGVSYXRlKSB7CiAgICB2YXIgb3V0cHV0U2FtcGxlUmF0ZSA9IGFyZ3VtZW50cy5sZW5ndGggPiAxICYmIGFyZ3VtZW50c1sxXSAhPT0gdW5kZWZpbmVkID8gYXJndW1lbnRzWzFdIDogUFZfU0FNUExFX1JBVEU7CiAgICB2YXIgZnJhbWVMZW5ndGggPSBhcmd1bWVudHMubGVuZ3RoID4gMiAmJiBhcmd1bWVudHNbMl0gIT09IHVuZGVmaW5lZCA/IGFyZ3VtZW50c1syXSA6IFBWX0ZSQU1FX0xFTkdUSDsKICAgIF9pbnB1dFNhbXBsZVJhdGUgPSBpbnB1dFNhbXBsZVJhdGU7CiAgICBfb3V0cHV0U2FtcGxlUmF0ZSA9IG91dHB1dFNhbXBsZVJhdGU7CiAgICBfZnJhbWVMZW5ndGggPSBmcmFtZUxlbmd0aDsKICAgIGNvbnNvbGUuYXNzZXJ0KE51bWJlci5pc0ludGVnZXIoX2lucHV0U2FtcGxlUmF0ZSkpOwogICAgY29uc29sZS5hc3NlcnQoTnVtYmVyLmlzSW50ZWdlcihfb3V0cHV0U2FtcGxlUmF0ZSkpOwogICAgY29uc29sZS5hc3NlcnQoTnVtYmVyLmlzSW50ZWdlcihfZnJhbWVMZW5ndGgpKTsKICAgIF9pbnB1dEJ1ZmZlciA9IFtdOwogIH0KCiAgZnVuY3Rpb24gc3RhcnRBdWRpb0R1bXAoKSB7CiAgICB2YXIgZHVyYXRpb25NcyA9IGFyZ3VtZW50cy5sZW5ndGggPiAwICYmIGFyZ3VtZW50c1swXSAhPT0gdW5kZWZpbmVkID8gYXJndW1lbnRzWzBdIDogMzAwMDsKICAgIF9hdWRpb0R1bXBOdW1GcmFtZXMgPSBkdXJhdGlvbk1zICogKFBWX0ZSQU1FX0xFTkdUSCAvIFBWX1NBTVBMRV9SQVRFKTsKICAgIF9hdWRpb0R1bXBBY3RpdmUgPSB0cnVlOwogICAgX2F1ZGlvRHVtcEJ1ZmZlckluZGV4ID0gMDsKICAgIF9hdWRpb0R1bXBCdWZmZXIgPSBuZXcgSW50MTZBcnJheShfYXVkaW9EdW1wTnVtRnJhbWVzICogX2ZyYW1lTGVuZ3RoKTsKICB9CgogIGZ1bmN0aW9uIHByb2Nlc3NBdWRpbyhpbnB1dEZyYW1lKSB7CiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGlucHV0RnJhbWUubGVuZ3RoOyBpKyspIHsKICAgICAgX2lucHV0QnVmZmVyLnB1c2goaW5wdXRGcmFtZVtpXSAqIFNfSU5UMTZfTUFYKTsKICAgIH0KCiAgICB3aGlsZSAoX2lucHV0QnVmZmVyLmxlbmd0aCAqIF9vdXRwdXRTYW1wbGVSYXRlIC8gX2lucHV0U2FtcGxlUmF0ZSA+IF9mcmFtZUxlbmd0aCkgewogICAgICB2YXIgb3V0cHV0RnJhbWUgPSBuZXcgSW50MTZBcnJheShfZnJhbWVMZW5ndGgpOwogICAgICB2YXIgc3VtID0gMDsKICAgICAgdmFyIG51bSA9IDA7CiAgICAgIHZhciBvdXRwdXRJbmRleCA9IDA7CiAgICAgIHZhciBpbnB1dEluZGV4ID0gMDsKCiAgICAgIHdoaWxlIChvdXRwdXRJbmRleCA8IF9mcmFtZUxlbmd0aCkgewogICAgICAgIHN1bSA9IDA7CiAgICAgICAgbnVtID0gMDsKCiAgICAgICAgd2hpbGUgKGlucHV0SW5kZXggPCBNYXRoLm1pbihfaW5wdXRCdWZmZXIubGVuZ3RoLCAob3V0cHV0SW5kZXggKyAxKSAqIF9pbnB1dFNhbXBsZVJhdGUgLyBfb3V0cHV0U2FtcGxlUmF0ZSkpIHsKICAgICAgICAgIHN1bSArPSBfaW5wdXRCdWZmZXJbaW5wdXRJbmRleF07CiAgICAgICAgICBudW0rKzsKICAgICAgICAgIGlucHV0SW5kZXgrKzsKICAgICAgICB9CgogICAgICAgIG91dHB1dEZyYW1lW291dHB1dEluZGV4XSA9IHN1bSAvIG51bTsKICAgICAgICBvdXRwdXRJbmRleCsrOwogICAgICB9CgogICAgICBpZiAoX2F1ZGlvRHVtcEFjdGl2ZSkgewogICAgICAgIF9hdWRpb0R1bXBCdWZmZXIuc2V0KG91dHB1dEZyYW1lLCBfYXVkaW9EdW1wQnVmZmVySW5kZXggKiBfZnJhbWVMZW5ndGgpOwoKICAgICAgICBfYXVkaW9EdW1wQnVmZmVySW5kZXgrKzsKCiAgICAgICAgaWYgKF9hdWRpb0R1bXBCdWZmZXJJbmRleCA9PT0gX2F1ZGlvRHVtcE51bUZyYW1lcykgewogICAgICAgICAgX2F1ZGlvRHVtcEFjdGl2ZSA9IGZhbHNlOyAvLyBEb25lIGNvbGxlY3RpbmcgZnJhbWVzLCBjcmVhdGUgYSBCbG9iIGFuZCBzZW5kIGl0IHRvIG1haW4gdGhyZWFkCgogICAgICAgICAgdmFyIHBjbUJsb2IgPSBuZXcgQmxvYihbX2F1ZGlvRHVtcEJ1ZmZlcl0sIHsKICAgICAgICAgICAgdHlwZTogJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScKICAgICAgICAgIH0pOwogICAgICAgICAgcG9zdE1lc3NhZ2UoewogICAgICAgICAgICBjb21tYW5kOiAnYXVkaW9fZHVtcF9jb21wbGV0ZScsCiAgICAgICAgICAgIGJsb2I6IHBjbUJsb2IKICAgICAgICAgIH0sIHVuZGVmaW5lZCk7CiAgICAgICAgfQogICAgICB9CgogICAgICBwb3N0TWVzc2FnZSh7CiAgICAgICAgY29tbWFuZDogJ291dHB1dCcsCiAgICAgICAgb3V0cHV0RnJhbWU6IG91dHB1dEZyYW1lCiAgICAgIH0sIHVuZGVmaW5lZCk7CiAgICAgIF9pbnB1dEJ1ZmZlciA9IF9pbnB1dEJ1ZmZlci5zbGljZShpbnB1dEluZGV4KTsKICAgIH0KICB9CgogIGZ1bmN0aW9uIHJlc2V0KCkgewogICAgX2lucHV0QnVmZmVyID0gW107CiAgfQoKICBvbm1lc3NhZ2UgPSBmdW5jdGlvbiBvbm1lc3NhZ2UoZXZlbnQpIHsKICAgIHN3aXRjaCAoZXZlbnQuZGF0YS5jb21tYW5kKSB7CiAgICAgIGNhc2UgJ2luaXQnOgogICAgICAgIGluaXQoZXZlbnQuZGF0YS5pbnB1dFNhbXBsZVJhdGUsIGV2ZW50LmRhdGEub3V0cHV0U2FtcGxlUmF0ZSwgZXZlbnQuZGF0YS5mcmFtZUxlbmd0aCk7CiAgICAgICAgYnJlYWs7CgogICAgICBjYXNlICdwcm9jZXNzJzoKICAgICAgICBwcm9jZXNzQXVkaW8oZXZlbnQuZGF0YS5pbnB1dEZyYW1lKTsKICAgICAgICBicmVhazsKCiAgICAgIGNhc2UgJ3Jlc2V0JzoKICAgICAgICByZXNldCgpOwogICAgICAgIGJyZWFrOwoKICAgICAgY2FzZSAnc3RhcnRfYXVkaW9fZHVtcCc6CiAgICAgICAgc3RhcnRBdWRpb0R1bXAoZXZlbnQuZGF0YS5kdXJhdGlvbk1zKTsKICAgICAgICBicmVhazsKCiAgICAgIGRlZmF1bHQ6CiAgICAgICAgY29uc29sZS53YXJuKCJVbmhhbmRsZWQgbWVzc2FnZSBpbiBkb3duc2FtcGxpbmdfd29ya2VyLnRzOiAiLmNvbmNhdChldmVudC5kYXRhLmNvbW1hbmQpKTsKICAgICAgICBicmVhazsKICAgIH0KICB9OwoKfSgpKTsKCg==', 'data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG93bnNhbXBsaW5nX3dvcmtlci5qcyIsInNvdXJjZXMiOlsid29ya2VyOi8vd2ViLXdvcmtlci9kb3duc2FtcGxpbmdfd29ya2VyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gICAgQ29weXJpZ2h0IDIwMTgtMjAyMSBQaWNvdm9pY2UgSW5jLlxuXG4gICAgWW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBsaWNlbnNlLiBBIGNvcHkgb2YgdGhlIGxpY2Vuc2UgaXMgbG9jYXRlZCBpbiB0aGUgXCJMSUNFTlNFXCJcbiAgICBmaWxlIGFjY29tcGFueWluZyB0aGlzIHNvdXJjZS5cblxuICAgIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmUgZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb25cbiAgICBhbiBcIkFTIElTXCIgQkFTSVMsIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZVxuICAgIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmQgbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4qL1xuXG5pbXBvcnQgeyBEb3duc2FtcGxpbmdXb3JrZXJSZXF1ZXN0IH0gZnJvbSAnLi93b3JrZXJfdHlwZXMnO1xuXG5jb25zdCBQVl9GUkFNRV9MRU5HVEggPSA1MTI7XG5jb25zdCBQVl9TQU1QTEVfUkFURSA9IDE2MDAwO1xuY29uc3QgU19JTlQxNl9NQVggPSAzMjc2NztcblxubGV0IF9pbnB1dFNhbXBsZVJhdGU6IG51bWJlcjtcbmxldCBfb3V0cHV0U2FtcGxlUmF0ZTogbnVtYmVyO1xubGV0IF9mcmFtZUxlbmd0aDogbnVtYmVyO1xubGV0IF9pbnB1dEJ1ZmZlcjogQXJyYXk8bnVtYmVyPiA9IFtdO1xuXG5sZXQgX2F1ZGlvRHVtcEFjdGl2ZTogYm9vbGVhbjtcbmxldCBfYXVkaW9EdW1wQnVmZmVyOiBJbnQxNkFycmF5O1xubGV0IF9hdWRpb0R1bXBCdWZmZXJJbmRleDogbnVtYmVyO1xubGV0IF9hdWRpb0R1bXBOdW1GcmFtZXM6IG51bWJlcjtcblxuZnVuY3Rpb24gaW5pdChcbiAgaW5wdXRTYW1wbGVSYXRlOiBudW1iZXIsXG4gIG91dHB1dFNhbXBsZVJhdGU6IG51bWJlciA9IFBWX1NBTVBMRV9SQVRFLFxuICBmcmFtZUxlbmd0aDogbnVtYmVyID0gUFZfRlJBTUVfTEVOR1RILFxuKTogdm9pZCB7XG4gIF9pbnB1dFNhbXBsZVJhdGUgPSBpbnB1dFNhbXBsZVJhdGU7XG4gIF9vdXRwdXRTYW1wbGVSYXRlID0gb3V0cHV0U2FtcGxlUmF0ZTtcbiAgX2ZyYW1lTGVuZ3RoID0gZnJhbWVMZW5ndGg7XG5cbiAgY29uc29sZS5hc3NlcnQoTnVtYmVyLmlzSW50ZWdlcihfaW5wdXRTYW1wbGVSYXRlKSk7XG4gIGNvbnNvbGUuYXNzZXJ0KE51bWJlci5pc0ludGVnZXIoX291dHB1dFNhbXBsZVJhdGUpKTtcbiAgY29uc29sZS5hc3NlcnQoTnVtYmVyLmlzSW50ZWdlcihfZnJhbWVMZW5ndGgpKTtcblxuICBfaW5wdXRCdWZmZXIgPSBbXTtcbn1cblxuZnVuY3Rpb24gc3RhcnRBdWRpb0R1bXAoZHVyYXRpb25NczogbnVtYmVyID0gMzAwMCk6IHZvaWQge1xuICBfYXVkaW9EdW1wTnVtRnJhbWVzID0gZHVyYXRpb25NcyAqIChQVl9GUkFNRV9MRU5HVEggLyBQVl9TQU1QTEVfUkFURSk7XG4gIF9hdWRpb0R1bXBBY3RpdmUgPSB0cnVlO1xuICBfYXVkaW9EdW1wQnVmZmVySW5kZXggPSAwO1xuICBfYXVkaW9EdW1wQnVmZmVyID0gbmV3IEludDE2QXJyYXkoX2F1ZGlvRHVtcE51bUZyYW1lcyAqIF9mcmFtZUxlbmd0aCk7XG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NBdWRpbyhpbnB1dEZyYW1lOiBGbG9hdDMyQXJyYXkpOiB2b2lkIHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBpbnB1dEZyYW1lLmxlbmd0aDsgaSsrKSB7XG4gICAgX2lucHV0QnVmZmVyLnB1c2goaW5wdXRGcmFtZVtpXSAqIFNfSU5UMTZfTUFYKTtcbiAgfVxuXG4gIHdoaWxlIChcbiAgICAoX2lucHV0QnVmZmVyLmxlbmd0aCAqIF9vdXRwdXRTYW1wbGVSYXRlKSAvIF9pbnB1dFNhbXBsZVJhdGUgPlxuICAgIF9mcmFtZUxlbmd0aFxuICApIHtcbiAgICBjb25zdCBvdXRwdXRGcmFtZSA9IG5ldyBJbnQxNkFycmF5KF9mcmFtZUxlbmd0aCk7XG4gICAgbGV0IHN1bSA9IDA7XG4gICAgbGV0IG51bSA9IDA7XG4gICAgbGV0IG91dHB1dEluZGV4ID0gMDtcbiAgICBsZXQgaW5wdXRJbmRleCA9IDA7XG5cbiAgICB3aGlsZSAob3V0cHV0SW5kZXggPCBfZnJhbWVMZW5ndGgpIHtcbiAgICAgIHN1bSA9IDA7XG4gICAgICBudW0gPSAwO1xuICAgICAgd2hpbGUgKFxuICAgICAgICBpbnB1dEluZGV4IDxcbiAgICAgICAgTWF0aC5taW4oXG4gICAgICAgICAgX2lucHV0QnVmZmVyLmxlbmd0aCxcbiAgICAgICAgICAoKG91dHB1dEluZGV4ICsgMSkgKiBfaW5wdXRTYW1wbGVSYXRlKSAvIF9vdXRwdXRTYW1wbGVSYXRlLFxuICAgICAgICApXG4gICAgICApIHtcbiAgICAgICAgc3VtICs9IF9pbnB1dEJ1ZmZlcltpbnB1dEluZGV4XTtcbiAgICAgICAgbnVtKys7XG4gICAgICAgIGlucHV0SW5kZXgrKztcbiAgICAgIH1cbiAgICAgIG91dHB1dEZyYW1lW291dHB1dEluZGV4XSA9IHN1bSAvIG51bTtcbiAgICAgIG91dHB1dEluZGV4Kys7XG4gICAgfVxuXG4gICAgaWYgKF9hdWRpb0R1bXBBY3RpdmUpIHtcbiAgICAgIF9hdWRpb0R1bXBCdWZmZXIuc2V0KG91dHB1dEZyYW1lLCBfYXVkaW9EdW1wQnVmZmVySW5kZXggKiBfZnJhbWVMZW5ndGgpO1xuICAgICAgX2F1ZGlvRHVtcEJ1ZmZlckluZGV4Kys7XG5cbiAgICAgIGlmIChfYXVkaW9EdW1wQnVmZmVySW5kZXggPT09IF9hdWRpb0R1bXBOdW1GcmFtZXMpIHtcbiAgICAgICAgX2F1ZGlvRHVtcEFjdGl2ZSA9IGZhbHNlO1xuICAgICAgICAvLyBEb25lIGNvbGxlY3RpbmcgZnJhbWVzLCBjcmVhdGUgYSBCbG9iIGFuZCBzZW5kIGl0IHRvIG1haW4gdGhyZWFkXG4gICAgICAgIGNvbnN0IHBjbUJsb2IgPSBuZXcgQmxvYihbX2F1ZGlvRHVtcEJ1ZmZlcl0sIHtcbiAgICAgICAgICB0eXBlOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcG9zdE1lc3NhZ2UoXG4gICAgICAgICAge1xuICAgICAgICAgICAgY29tbWFuZDogJ2F1ZGlvX2R1bXBfY29tcGxldGUnLFxuICAgICAgICAgICAgYmxvYjogcGNtQmxvYixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHVuZGVmaW5lZCBhcyBhbnksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcG9zdE1lc3NhZ2UoXG4gICAgICB7XG4gICAgICAgIGNvbW1hbmQ6ICdvdXRwdXQnLFxuICAgICAgICBvdXRwdXRGcmFtZTogb3V0cHV0RnJhbWUsXG4gICAgICB9LFxuICAgICAgdW5kZWZpbmVkIGFzIGFueSxcbiAgICApO1xuXG4gICAgX2lucHV0QnVmZmVyID0gX2lucHV0QnVmZmVyLnNsaWNlKGlucHV0SW5kZXgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlc2V0KCk6IHZvaWQge1xuICBfaW5wdXRCdWZmZXIgPSBbXTtcbn1cblxub25tZXNzYWdlID0gZnVuY3Rpb24gKGV2ZW50OiBNZXNzYWdlRXZlbnQ8RG93bnNhbXBsaW5nV29ya2VyUmVxdWVzdD4pOiB2b2lkIHtcbiAgc3dpdGNoIChldmVudC5kYXRhLmNvbW1hbmQpIHtcbiAgICBjYXNlICdpbml0JzpcbiAgICAgIGluaXQoXG4gICAgICAgIGV2ZW50LmRhdGEuaW5wdXRTYW1wbGVSYXRlLFxuICAgICAgICBldmVudC5kYXRhLm91dHB1dFNhbXBsZVJhdGUsXG4gICAgICAgIGV2ZW50LmRhdGEuZnJhbWVMZW5ndGgsXG4gICAgICApO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncHJvY2Vzcyc6XG4gICAgICBwcm9jZXNzQXVkaW8oZXZlbnQuZGF0YS5pbnB1dEZyYW1lKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3Jlc2V0JzpcbiAgICAgIHJlc2V0KCk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdzdGFydF9hdWRpb19kdW1wJzpcbiAgICAgIHN0YXJ0QXVkaW9EdW1wKGV2ZW50LmRhdGEuZHVyYXRpb25Ncyk7XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0OlxuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBgVW5oYW5kbGVkIG1lc3NhZ2UgaW4gZG93bnNhbXBsaW5nX3dvcmtlci50czogJHtldmVudC5kYXRhLmNvbW1hbmR9YCxcbiAgICAgICk7XG4gICAgICBicmVhaztcbiAgfVxufTtcbiJdLCJuYW1lcyI6WyJQVl9GUkFNRV9MRU5HVEgiLCJQVl9TQU1QTEVfUkFURSIsIlNfSU5UMTZfTUFYIiwiX2lucHV0U2FtcGxlUmF0ZSIsIl9vdXRwdXRTYW1wbGVSYXRlIiwiX2ZyYW1lTGVuZ3RoIiwiX2lucHV0QnVmZmVyIiwiX2F1ZGlvRHVtcEFjdGl2ZSIsIl9hdWRpb0R1bXBCdWZmZXIiLCJfYXVkaW9EdW1wQnVmZmVySW5kZXgiLCJfYXVkaW9EdW1wTnVtRnJhbWVzIiwiaW5pdCIsImlucHV0U2FtcGxlUmF0ZSIsIm91dHB1dFNhbXBsZVJhdGUiLCJmcmFtZUxlbmd0aCIsImNvbnNvbGUiLCJhc3NlcnQiLCJOdW1iZXIiLCJpc0ludGVnZXIiLCJzdGFydEF1ZGlvRHVtcCIsImR1cmF0aW9uTXMiLCJJbnQxNkFycmF5IiwicHJvY2Vzc0F1ZGlvIiwiaW5wdXRGcmFtZSIsImkiLCJsZW5ndGgiLCJwdXNoIiwib3V0cHV0RnJhbWUiLCJzdW0iLCJudW0iLCJvdXRwdXRJbmRleCIsImlucHV0SW5kZXgiLCJNYXRoIiwibWluIiwic2V0IiwicGNtQmxvYiIsIkJsb2IiLCJ0eXBlIiwicG9zdE1lc3NhZ2UiLCJjb21tYW5kIiwiYmxvYiIsInVuZGVmaW5lZCIsInNsaWNlIiwicmVzZXQiLCJvbm1lc3NhZ2UiLCJldmVudCIsImRhdGEiLCJ3YXJuIl0sIm1hcHBpbmdzIjoiOzs7RUFBQTs7Ozs7Ozs7OztFQWFBLElBQU1BLGVBQWUsR0FBRyxHQUF4QjtFQUNBLElBQU1DLGNBQWMsR0FBRyxLQUF2QjtFQUNBLElBQU1DLFdBQVcsR0FBRyxLQUFwQjs7RUFFQSxJQUFJQyxnQkFBSjs7RUFDQSxJQUFJQyxpQkFBSjs7RUFDQSxJQUFJQyxZQUFKOztFQUNBLElBQUlDLFlBQVksR0FBa0IsRUFBbEM7O0VBRUEsSUFBSUMsZ0JBQUo7O0VBQ0EsSUFBSUMsZ0JBQUo7O0VBQ0EsSUFBSUMscUJBQUo7O0VBQ0EsSUFBSUMsbUJBQUo7O0VBRUEsU0FBU0MsSUFBVCxDQUNFQyxlQURGO1FBRUVDLHVGQUEyQlo7UUFDM0JhLGtGQUFzQmQ7RUFFdEJHLEVBQUFBLGdCQUFnQixHQUFHUyxlQUFuQjtFQUNBUixFQUFBQSxpQkFBaUIsR0FBR1MsZ0JBQXBCO0VBQ0FSLEVBQUFBLFlBQVksR0FBR1MsV0FBZjtFQUVBQyxFQUFBQSxPQUFPLENBQUNDLE1BQVIsQ0FBZUMsTUFBTSxDQUFDQyxTQUFQLENBQWlCZixnQkFBakIsQ0FBZjtFQUNBWSxFQUFBQSxPQUFPLENBQUNDLE1BQVIsQ0FBZUMsTUFBTSxDQUFDQyxTQUFQLENBQWlCZCxpQkFBakIsQ0FBZjtFQUNBVyxFQUFBQSxPQUFPLENBQUNDLE1BQVIsQ0FBZUMsTUFBTSxDQUFDQyxTQUFQLENBQWlCYixZQUFqQixDQUFmO0VBRUFDLEVBQUFBLFlBQVksR0FBRyxFQUFmO0VBQ0Q7O0VBRUQsU0FBU2EsY0FBVDtRQUF3QkMsaUZBQXFCO0VBQzNDVixFQUFBQSxtQkFBbUIsR0FBR1UsVUFBVSxJQUFJcEIsZUFBZSxHQUFHQyxjQUF0QixDQUFoQztFQUNBTSxFQUFBQSxnQkFBZ0IsR0FBRyxJQUFuQjtFQUNBRSxFQUFBQSxxQkFBcUIsR0FBRyxDQUF4QjtFQUNBRCxFQUFBQSxnQkFBZ0IsR0FBRyxJQUFJYSxVQUFKLENBQWVYLG1CQUFtQixHQUFHTCxZQUFyQyxDQUFuQjtFQUNEOztFQUVELFNBQVNpQixZQUFULENBQXNCQyxVQUF0QjtFQUNFLE9BQUssSUFBSUMsQ0FBQyxHQUFHLENBQWIsRUFBZ0JBLENBQUMsR0FBR0QsVUFBVSxDQUFDRSxNQUEvQixFQUF1Q0QsQ0FBQyxFQUF4QyxFQUE0QztFQUMxQ2xCLElBQUFBLFlBQVksQ0FBQ29CLElBQWIsQ0FBa0JILFVBQVUsQ0FBQ0MsQ0FBRCxDQUFWLEdBQWdCdEIsV0FBbEM7RUFDRDs7RUFFRCxTQUNHSSxZQUFZLENBQUNtQixNQUFiLEdBQXNCckIsaUJBQXZCLEdBQTRDRCxnQkFBNUMsR0FDQUUsWUFGRixFQUdFO0VBQ0EsUUFBTXNCLFdBQVcsR0FBRyxJQUFJTixVQUFKLENBQWVoQixZQUFmLENBQXBCO0VBQ0EsUUFBSXVCLEdBQUcsR0FBRyxDQUFWO0VBQ0EsUUFBSUMsR0FBRyxHQUFHLENBQVY7RUFDQSxRQUFJQyxXQUFXLEdBQUcsQ0FBbEI7RUFDQSxRQUFJQyxVQUFVLEdBQUcsQ0FBakI7O0VBRUEsV0FBT0QsV0FBVyxHQUFHekIsWUFBckIsRUFBbUM7RUFDakN1QixNQUFBQSxHQUFHLEdBQUcsQ0FBTjtFQUNBQyxNQUFBQSxHQUFHLEdBQUcsQ0FBTjs7RUFDQSxhQUNFRSxVQUFVLEdBQ1ZDLElBQUksQ0FBQ0MsR0FBTCxDQUNFM0IsWUFBWSxDQUFDbUIsTUFEZixFQUVHLENBQUNLLFdBQVcsR0FBRyxDQUFmLElBQW9CM0IsZ0JBQXJCLEdBQXlDQyxpQkFGM0MsQ0FGRixFQU1FO0VBQ0F3QixRQUFBQSxHQUFHLElBQUl0QixZQUFZLENBQUN5QixVQUFELENBQW5CO0VBQ0FGLFFBQUFBLEdBQUc7RUFDSEUsUUFBQUEsVUFBVTtFQUNYOztFQUNESixNQUFBQSxXQUFXLENBQUNHLFdBQUQsQ0FBWCxHQUEyQkYsR0FBRyxHQUFHQyxHQUFqQztFQUNBQyxNQUFBQSxXQUFXO0VBQ1o7O0VBRUQsUUFBSXZCLGdCQUFKLEVBQXNCO0VBQ3BCQyxNQUFBQSxnQkFBZ0IsQ0FBQzBCLEdBQWpCLENBQXFCUCxXQUFyQixFQUFrQ2xCLHFCQUFxQixHQUFHSixZQUExRDs7RUFDQUksTUFBQUEscUJBQXFCOztFQUVyQixVQUFJQSxxQkFBcUIsS0FBS0MsbUJBQTlCLEVBQW1EO0VBQ2pESCxRQUFBQSxnQkFBZ0IsR0FBRyxLQUFuQixDQURpRDs7RUFHakQsWUFBTTRCLE9BQU8sR0FBRyxJQUFJQyxJQUFKLENBQVMsQ0FBQzVCLGdCQUFELENBQVQsRUFBNkI7RUFDM0M2QixVQUFBQSxJQUFJLEVBQUU7RUFEcUMsU0FBN0IsQ0FBaEI7RUFJQUMsUUFBQUEsV0FBVyxDQUNUO0VBQ0VDLFVBQUFBLE9BQU8sRUFBRSxxQkFEWDtFQUVFQyxVQUFBQSxJQUFJLEVBQUVMO0VBRlIsU0FEUyxFQUtUTSxTQUxTLENBQVg7RUFPRDtFQUNGOztFQUVESCxJQUFBQSxXQUFXLENBQ1Q7RUFDRUMsTUFBQUEsT0FBTyxFQUFFLFFBRFg7RUFFRVosTUFBQUEsV0FBVyxFQUFFQTtFQUZmLEtBRFMsRUFLVGMsU0FMUyxDQUFYO0VBUUFuQyxJQUFBQSxZQUFZLEdBQUdBLFlBQVksQ0FBQ29DLEtBQWIsQ0FBbUJYLFVBQW5CLENBQWY7RUFDRDtFQUNGOztFQUVELFNBQVNZLEtBQVQ7RUFDRXJDLEVBQUFBLFlBQVksR0FBRyxFQUFmO0VBQ0Q7O0VBRURzQyxTQUFTLEdBQUcsbUJBQVVDLEtBQVY7RUFDVixVQUFRQSxLQUFLLENBQUNDLElBQU4sQ0FBV1AsT0FBbkI7RUFDRSxTQUFLLE1BQUw7RUFDRTVCLE1BQUFBLElBQUksQ0FDRmtDLEtBQUssQ0FBQ0MsSUFBTixDQUFXbEMsZUFEVCxFQUVGaUMsS0FBSyxDQUFDQyxJQUFOLENBQVdqQyxnQkFGVCxFQUdGZ0MsS0FBSyxDQUFDQyxJQUFOLENBQVdoQyxXQUhULENBQUo7RUFLQTs7RUFDRixTQUFLLFNBQUw7RUFDRVEsTUFBQUEsWUFBWSxDQUFDdUIsS0FBSyxDQUFDQyxJQUFOLENBQVd2QixVQUFaLENBQVo7RUFDQTs7RUFDRixTQUFLLE9BQUw7RUFDRW9CLE1BQUFBLEtBQUs7RUFDTDs7RUFDRixTQUFLLGtCQUFMO0VBQ0V4QixNQUFBQSxjQUFjLENBQUMwQixLQUFLLENBQUNDLElBQU4sQ0FBVzFCLFVBQVosQ0FBZDtFQUNBOztFQUNGO0VBQ0VMLE1BQUFBLE9BQU8sQ0FBQ2dDLElBQVIsd0RBQ2tERixLQUFLLENBQUNDLElBQU4sQ0FBV1AsT0FEN0Q7RUFHQTtFQXJCSjtFQXVCRCxDQXhCRDs7Ozs7OyJ9', false);
	/* eslint-enable */

	function _createForOfIteratorHelper(o, allowArrayLike) { var it; if (typeof Symbol === "undefined" || o[Symbol.iterator] == null) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function F() {}; return { s: F, n: function n() { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function e(_e) { throw _e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function s() { it = o[Symbol.iterator](); }, n: function n() { var step = it.next(); normalCompletion = step.done; return step; }, e: function e(_e2) { didErr = true; err = _e2; }, f: function f() { try { if (!normalCompletion && it["return"] != null) it["return"](); } finally { if (didErr) throw err; } } }; }

	function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

	function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }
	/**
	 * Obtain microphone permission and audio stream;
	 * Downsample audio into 16kHz single-channel PCM for speech recognition (via DownsamplingWorker).
	 * Continuously send audio frames to voice processing engines.
	 */

	var WebVoiceProcessor = /*#__PURE__*/function () {
	  function WebVoiceProcessor(inputMediaStream, options) {
	    var _options$start,
	        _this = this;

	    classCallCheck(this, WebVoiceProcessor);

	    this._audioDumpPromise = null;
	    this._audioDumpResolve = null;
	    this._audioDumpReject = null;

	    if (options.engines === undefined) {
	      this._engines = [];
	    } else {
	      this._engines = options.engines;
	    }

	    this._isRecording = (_options$start = options.start) !== null && _options$start !== void 0 ? _options$start : true;
	    this._downsamplingWorker = new WorkerFactory();
	    this._audioContext = new (window.AudioContext || // @ts-ignore window.webkitAudioContext
	    window.webkitAudioContext)();

	    var audioSource = this._audioContext.createMediaStreamSource(inputMediaStream);

	    var node = this._audioContext.createScriptProcessor(4096, 1, 1);

	    node.onaudioprocess = function (event) {
	      if (!_this._isRecording) {
	        return;
	      }

	      _this._downsamplingWorker.postMessage({
	        command: 'process',
	        inputFrame: event.inputBuffer.getChannelData(0)
	      });
	    };

	    audioSource.connect(node);
	    node.connect(this._audioContext.destination);

	    this._downsamplingWorker.postMessage({
	      command: 'init',
	      inputSampleRate: audioSource.context.sampleRate,
	      outputSampleRate: options.outputSampleRate,
	      frameLength: options.frameLength
	    });

	    this._downsamplingWorker.onmessage = function (event) {
	      switch (event.data.command) {
	        case 'output':
	          {
	            var _iterator = _createForOfIteratorHelper(_this._engines),
	                _step;

	            try {
	              for (_iterator.s(); !(_step = _iterator.n()).done;) {
	                var engine = _step.value;
	                engine.postMessage({
	                  command: 'process',
	                  inputFrame: event.data.outputFrame
	                });
	              }
	            } catch (err) {
	              _iterator.e(err);
	            } finally {
	              _iterator.f();
	            }

	            break;
	          }

	        case 'audio_dump_complete':
	          {
	            _this._audioDumpResolve(event.data.blob);

	            _this._audioDumpPromise = null;
	            _this._audioDumpResolve = null;
	            _this._audioDumpReject = null;
	            break;
	          }
	      }
	    };
	  }
	  /**
	   * Acquires the microphone audio stream (incl. asking permission),
	   * and continuously forwards the downsampled audio to speech recognition worker engines.
	   *
	   * @param options Startup options including whether to immediately begin
	   * processing, and the set of voice processing engines
	   * @return the promise from mediaDevices.getUserMedia()
	   */


	  createClass(WebVoiceProcessor, [{
	    key: "audioDump",
	    value:
	    /**
	     * Record some sample raw signed 16-bit PCM data for some duration, then pack it as a Blob
	     *
	     * @param durationMs the duration of the recording, in milliseconds
	     * @return the data in Blob format, wrapped in a promise
	     */
	    function () {
	      var _audioDump = asyncToGenerator( /*#__PURE__*/regenerator.mark(function _callee() {
	        var _this2 = this;

	        var durationMs,
	            _args = arguments;
	        return regenerator.wrap(function _callee$(_context) {
	          while (1) {
	            switch (_context.prev = _context.next) {
	              case 0:
	                durationMs = _args.length > 0 && _args[0] !== undefined ? _args[0] : 3000;

	                if (!(this._audioDumpPromise !== null)) {
	                  _context.next = 3;
	                  break;
	                }

	                return _context.abrupt("return", Promise.reject('Audio dump already in progress'));

	              case 3:
	                this._downsamplingWorker.postMessage({
	                  command: 'start_audio_dump',
	                  durationMs: durationMs
	                });

	                this._audioDumpPromise = new Promise(function (resolve, reject) {
	                  _this2._audioDumpResolve = resolve;
	                  _this2._audioDumpReject = reject;
	                });
	                return _context.abrupt("return", this._audioDumpPromise);

	              case 6:
	              case "end":
	                return _context.stop();
	            }
	          }
	        }, _callee, this);
	      }));

	      function audioDump() {
	        return _audioDump.apply(this, arguments);
	      }

	      return audioDump;
	    }()
	    /**
	     * Stop listening to the microphone & release all resources; terminate downsampling worker.
	     *
	     * @return the promise from AudioContext.close()
	     */

	  }, {
	    key: "release",
	    value: function () {
	      var _release = asyncToGenerator( /*#__PURE__*/regenerator.mark(function _callee2() {
	        return regenerator.wrap(function _callee2$(_context2) {
	          while (1) {
	            switch (_context2.prev = _context2.next) {
	              case 0:
	                this._isRecording = false;

	                this._downsamplingWorker.postMessage({
	                  command: 'reset'
	                });

	                this._downsamplingWorker.terminate();

	                _context2.next = 5;
	                return this._audioContext.close();

	              case 5:
	              case "end":
	                return _context2.stop();
	            }
	          }
	        }, _callee2, this);
	      }));

	      function release() {
	        return _release.apply(this, arguments);
	      }

	      return release;
	    }()
	  }, {
	    key: "start",
	    value: function start() {
	      this._isRecording = true;
	    }
	  }, {
	    key: "pause",
	    value: function pause() {
	      this._isRecording = false;
	    }
	  }, {
	    key: "resume",
	    value: function resume() {
	      this._isRecording = true;
	    }
	  }, {
	    key: "audioContext",
	    get: function get() {
	      return this._audioContext;
	    }
	  }, {
	    key: "isRecording",
	    get: function get() {
	      return this._isRecording;
	    }
	  }], [{
	    key: "init",
	    value: function () {
	      var _init = asyncToGenerator( /*#__PURE__*/regenerator.mark(function _callee3(options) {
	        var microphoneStream;
	        return regenerator.wrap(function _callee3$(_context3) {
	          while (1) {
	            switch (_context3.prev = _context3.next) {
	              case 0:
	                _context3.next = 2;
	                return navigator.mediaDevices.getUserMedia({
	                  audio: true
	                });

	              case 2:
	                microphoneStream = _context3.sent;
	                return _context3.abrupt("return", new WebVoiceProcessor(microphoneStream, options));

	              case 4:
	              case "end":
	                return _context3.stop();
	            }
	          }
	        }, _callee3);
	      }));

	      function init(_x) {
	        return _init.apply(this, arguments);
	      }

	      return init;
	    }()
	  }]);

	  return WebVoiceProcessor;
	}();

	var _typeof_1 = createCommonjsModule(function (module) {
	function _typeof(obj) {
	  "@babel/helpers - typeof";

	  if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
	    module.exports = _typeof = function _typeof(obj) {
	      return typeof obj;
	    };
	  } else {
	    module.exports = _typeof = function _typeof(obj) {
	      return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
	    };
	  }

	  return _typeof(obj);
	}

	module.exports = _typeof;
	});

	/*
	    Copyright 2021 Picovoice Inc.

	    You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
	    file accompanying this source.

	    Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
	    an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
	    specific language governing permissions and limitations under the License.
	*/

	/**
	 * Check for browser compatibility with Picovoice: WebAssembly, Web Audio API, etc.
	 *
	 * @return object with compatibilty details, with special key '_picovoice' offering a yes/no answer.
	 */
	function browserCompatibilityCheck() {
	  // Are we in a secure context? Microphone access requires HTTPS (with the exception of localhost, for development)
	  var _isSecureContext = window.isSecureContext; // Web Audio API

	  var _mediaDevices = navigator.mediaDevices !== undefined;

	  var _webkitGetUserMedia = // @ts-ignore
	  navigator.webkitGetUserMedia !== undefined; // Web Workers


	  var _Worker = window.Worker !== undefined; // WebAssembly


	  var _WebAssembly = (typeof WebAssembly === "undefined" ? "undefined" : _typeof_1(WebAssembly)) === 'object'; // AudioWorklet (not yet used, due to lack of Safari support)


	  var _AudioWorklet = typeof AudioWorklet === 'function'; // Picovoice requirements met?


	  var _picovoice = _mediaDevices && _WebAssembly && _Worker;

	  return {
	    _picovoice: _picovoice,
	    AudioWorklet: _AudioWorklet,
	    isSecureContext: _isSecureContext,
	    mediaDevices: _mediaDevices,
	    WebAssembly: _WebAssembly,
	    webKitGetUserMedia: _webkitGetUserMedia,
	    Worker: _Worker
	  };
	}

	exports.WebVoiceProcessor = WebVoiceProcessor;
	exports.browserCompatibilityCheck = browserCompatibilityCheck;

	Object.defineProperty(exports, '__esModule', { value: true });

	return exports;

}({}));
