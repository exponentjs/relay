/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayRenderer
 * @typechecks
 * 
 */

'use strict';

var _inherits = require('babel-runtime/helpers/inherits')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _extends = require('babel-runtime/helpers/extends')['default'];

Object.defineProperty(exports, '__esModule', {
  value: true
});
var GraphQLFragmentPointer = require('./GraphQLFragmentPointer');
var React = require('react');

var RelayPropTypes = require('./RelayPropTypes');
var RelayStore = require('./RelayStore');

var StaticContainer = require('react-static-container');

var getRelayQueries = require('./getRelayQueries');
var invariant = require('fbjs/lib/invariant');
var isRelayContainer = require('./isRelayContainer');
var mapObject = require('fbjs/lib/mapObject');
var sprintf = require('fbjs/lib/sprintf');
var warning = require('fbjs/lib/warning');

var PropTypes = React.PropTypes;

/**
 * (GitHub #790): Remove once Component prop deprecation is complete.
 */
function containerFromProps(props) {
  var Container = props.Container || props.Component;
  return Container; // Non-null-ness is enforced by validator below.
}

/**
 * (GitHub #790): Remove once Component prop deprecation is complete.
 */
function componentPropTypeValidator(props, propName, componentName) {
  if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_ENV !== 'production' ? warning(propName !== 'Component' || !props.hasOwnProperty('Component'), 'RelayRenderer: Received deprecated `Component` prop on `%s`. ' + 'Pass your Relay.Container via the `Container` prop instead.', componentName) : undefined;
  }
  var Component = props.Component;
  var Container = props.Container;

  if ((Component || Container) == null) {
    return new Error(sprintf('Required prop `Container` was not specified in `%s`.', componentName));
  } else if (propName === 'Container' && Container && !isRelayContainer(Container) || propName === 'Component' && Component && !isRelayContainer(Component)) {
    return new Error(sprintf('Invalid prop `%s` supplied to `%s`, expected a RelayContainer.', propName, componentName));
  }
  return null;
}

/**
 * @public
 *
 * RelayRenderer renders a container and query config after fulfilling its data
 * dependencies. Precise rendering behavior is configured via the `render` prop
 * which takes a callback.
 *
 * The container created using `Relay.createContainer` must be supplied via the
 * `Container` prop, and the query configuration that conforms to the shape of a
 * `RelayQueryConfig` must be supplied via the `queryConfig` prop.
 *
 * === Render Callback ===
 *
 * The `render` callback is called with an object with the following properties:
 *
 *   props: ?Object
 *     If present, sufficient data is ready to render the container. This object
 *     must be spread into the container using the spread attribute operator. If
 *     absent, there is insufficient data to render the container.
 *
 *   done: boolean
 *     Whether all data dependencies have been fulfilled. If `props` is present
 *     but `done` is false, then sufficient data is ready to render, but some
 *     data dependencies have not yet been fulfilled.
 *
 *   error: ?Error
 *     If present, an error occurred while fulfilling data dependencies. If
 *     `props` and `error` are both present, then sufficient data is ready to
 *     render, but an error occurred while fulfilling deferred dependencies.
 *
 *   retry: ?Function
 *     A function that can be called to re-attempt to fulfill data dependencies.
 *     This property is only present if an `error` has occurred.
 *
 *   stale: boolean
 *     When `forceFetch` is enabled, a request is always made to fetch updated
 *     data. However, if all data dependencies can be immediately fulfilled, the
 *     `props` property will be present. In this case, `stale` will be true.
 *
 * The `render` callback can return `undefined` to continue rendering the last
 * view rendered (e.g. when transitioning from one `queryConfig` to another).
 *
 * If a `render` callback is not supplied, the default behavior is to render the
 * container if data is available, the existing view if one exists, or nothing.
 *
 * === Refs ===
 *
 * References to elements rendered by the `render` callback can be obtained by
 * using the React `ref` prop. For example:
 *
 *   <FooComponent {...props} ref={handleFooRef} />
 *
 *   function handleFooRef(component) {
 *     // Invoked when `<FooComponent>` is mounted or unmounted. When mounted,
 *     // `component` will be the component. When unmounted, `component` will
 *     // be null.
 *   }
 *
 */

var RelayRenderer = (function (_React$Component) {
  _inherits(RelayRenderer, _React$Component);

  function RelayRenderer(props, context) {
    _classCallCheck(this, RelayRenderer);

    _React$Component.call(this, props, context);
    var garbageCollector = RelayStore.getStoreData().getGarbageCollector();
    this.gcHold = garbageCollector && garbageCollector.acquireHold();
    this.mounted = true;
    this.state = this._runQueries(this.props);
  }

  RelayRenderer.prototype.getChildContext = function getChildContext() {
    return {
      relay: RelayStore,
      route: this.props.queryConfig
    };
  };

  /**
   * @private
   */

  RelayRenderer.prototype._runQueries = function _runQueries(props) {
    var _this = this;

    var forceFetch = props.forceFetch;
    var queryConfig = props.queryConfig;

    var Container = containerFromProps(props);
    var querySet = getRelayQueries(Container, queryConfig);
    var onReadyStateChange = function onReadyStateChange(readyState) {
      if (!_this.mounted) {
        _this._handleReadyStateChange(_extends({}, readyState, { mounted: false }));
        return;
      }
      var _state = _this.state;
      var pendingRequest = _state.pendingRequest;
      var props = _state.renderArgs.props;

      if (request !== pendingRequest) {
        // Ignore (abort) ready state if we have a new pending request.
        return;
      }
      if (readyState.aborted || readyState.done || readyState.error) {
        pendingRequest = null;
      }
      if (readyState.ready && !props) {
        props = _extends({}, queryConfig.params, mapObject(querySet, createFragmentPointerForRoot));
      }
      _this.setState({
        activeContainer: Container,
        activeQueryConfig: queryConfig,
        pendingRequest: pendingRequest,
        readyState: _extends({}, readyState, { mounted: true }),
        renderArgs: {
          done: readyState.done,
          error: readyState.error,
          props: props,
          retry: _this.state.renderArgs.retry,
          stale: readyState.stale
        }
      });
    };

    var request = forceFetch ? props.onForceFetch ? props.onForceFetch(querySet, onReadyStateChange) : RelayStore.forceFetch(querySet, onReadyStateChange) : props.onPrimeCache ? props.onPrimeCache(querySet, onReadyStateChange) : RelayStore.primeCache(querySet, onReadyStateChange);

    return {
      activeContainer: this.state ? this.state.activeContainer : null,
      activeQueryConfig: this.state ? this.state.activeQueryConfig : null,
      pendingRequest: request,
      readyState: null,
      renderArgs: {
        done: false,
        error: null,
        props: null,
        retry: this._retry.bind(this),
        stale: false
      }
    };
  };

  /**
   * Returns whether or not the view should be updated during the current render
   * pass. This is false between invoking `Relay.Store.{primeCache,forceFetch}`
   * and the first invocation of the `onReadyStateChange` callback if there is
   * an actively rendered container and query configuration.
   *
   * @private
   */

  RelayRenderer.prototype._shouldUpdate = function _shouldUpdate() {
    var _state2 = this.state;
    var activeContainer = _state2.activeContainer;
    var activeQueryConfig = _state2.activeQueryConfig;

    var Container = containerFromProps(this.props);
    return (!activeContainer || Container === activeContainer) && (!activeQueryConfig || this.props.queryConfig === activeQueryConfig);
  };

  /**
   * @private
   */

  RelayRenderer.prototype._retry = function _retry() {
    var readyState = this.state.readyState;

    !(readyState && readyState.error) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayRenderer: You tried to call `retry`, but the last request did ' + 'not fail. You can only call this when the last request has failed.') : invariant(false) : undefined;
    this.setState(this._runQueries(this.props));
  };

  RelayRenderer.prototype.componentWillReceiveProps = function componentWillReceiveProps(nextProps) {
    var Container = containerFromProps(this.props);
    var nextContainer = containerFromProps(nextProps);
    if (nextContainer !== Container || nextProps.queryConfig !== this.props.queryConfig || nextProps.forceFetch && !this.props.forceFetch) {
      if (this.state.pendingRequest) {
        this.state.pendingRequest.abort();
      }
      this.setState(this._runQueries(nextProps));
    }
  };

  RelayRenderer.prototype.componentDidUpdate = function componentDidUpdate(prevProps, prevState) {
    // `prevState` should exist; the truthy check is for Flow soundness.
    var readyState = this.state.readyState;

    if (readyState) {
      if (!prevState || readyState !== prevState.readyState) {
        this._handleReadyStateChange(readyState);
      }
    }
  };

  /**
   * @private
   */

  RelayRenderer.prototype._handleReadyStateChange = function _handleReadyStateChange(readyState) {
    var onReadyStateChange = this.props.onReadyStateChange;

    if (onReadyStateChange) {
      onReadyStateChange(readyState);
    }
  };

  RelayRenderer.prototype.componentWillUnmount = function componentWillUnmount() {
    if (this.state.pendingRequest) {
      this.state.pendingRequest.abort();
    }
    if (this.gcHold) {
      this.gcHold.release();
    }
    this.gcHold = null;
    this.mounted = false;
  };

  RelayRenderer.prototype.render = function render() {
    var children = undefined;
    var shouldUpdate = this._shouldUpdate();
    if (shouldUpdate) {
      var _render = this.props.render;

      var _Container = containerFromProps(this.props);
      var _renderArgs = this.state.renderArgs;

      if (_render) {
        children = _render(_renderArgs);
      } else if (_renderArgs.props) {
        children = React.createElement(_Container, _renderArgs.props);
      }
    }
    if (children === undefined) {
      children = null;
      shouldUpdate = false;
    }
    return React.createElement(
      StaticContainer,
      { shouldUpdate: shouldUpdate },
      children
    );
  };

  return RelayRenderer;
})(React.Component);

function createFragmentPointerForRoot(query) {
  return query ? GraphQLFragmentPointer.createForRoot(RelayStore.getStoreData().getQueuedStore(), query) : null;
}

RelayRenderer.propTypes = {
  // @deprecated Use `Container` instead.
  Component: componentPropTypeValidator,

  // (GitHub #790): Once Component is fully removed, can replace this with
  // `RelayPropTypes.Container`.
  Container: componentPropTypeValidator,

  forceFetch: PropTypes.bool,
  onReadyStateChange: PropTypes.func,
  queryConfig: RelayPropTypes.QueryConfig.isRequired,
  render: PropTypes.func
};

RelayRenderer.childContextTypes = {
  relay: RelayPropTypes.Context.isRequired,
  route: RelayPropTypes.QueryConfig.isRequired
};

module.exports = RelayRenderer;

// (GitHub #790): Once Component prop is fully removed this becomes mandatory.

// @deprecated: Use `Container` instead.