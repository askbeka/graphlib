import _ from 'lodash';

module.exports = Graph;

const
  DEFAULT_EDGE_NAME = "\x00",
  GRAPH_NODE = "\x00",
  EDGE_KEY_DELIM = "\x01";

// Implementation notes:
//
//  * Node id query functions should return string ids for the nodes
//  * Edge id query functions should return an "edgeObj", edge object, that is
//    composed of enough information to uniquely identify an edge: {v, w, name}.
//  * Internally we use an "edgeId", a stringified form of the edgeObj, to
//    reference edges. This is because we need a performant way to look these
//    edges up and, object properties, which have string keys, are the closest
//    we're going to get to a performant hashtable in JavaScript.

export default class Graph {

  constructor(opts, g) {
    if (g) {
      this.g = g;
    } else {
      this.g._isDirected = _.has(opts, "directed") ? opts.directed : true;
      this.g._isMultigraph = _.has(opts, "multigraph") ? opts.multigraph : false;
      this.g._isCompound = _.has(opts, "compound") ? opts.compound : false;
      this.g._isImmutable = _.has(opts, "immutable") ? opts._immutable : false;

      // Label for the graph itself
      this.g._label = undefined;

      // Defaults to be set when creating a new node
      this.g._defaultNodeLabelFn = _.constant(undefined);

      // Defaults to be set when creating a new edge
      this.g._defaultEdgeLabelFn = _.constant(undefined);

      // v -> label
      this.g._nodes = {};

      if (this.g._isCompound) {
        // v -> parent
        this.g._parent = {};

        // v -> children
        this.g._children = {};
        this.g._children[GRAPH_NODE] = {};
      }

      // v -> edgeObj
      this.g._in = {};

      // u -> v -> Number
      this.g._preds = {};

      // v -> edgeObj
      this.g._out = {};

      // v -> w -> Number
      this.g._sucs = {};

      // e -> edgeObj
      this.g._edgeObjs = {};

      // e -> label
      this.g._edgeLabels = {};

      this.g._opts = opts;
    }
  }

  /* Number of nodes in the graph. Should only be changed by the implementation. */
  _nodeCount = 0;

  /* Number of edges in the graph. Should only be changed by the implementation. */
  _edgeCount = 0;

  /* === Graph functions ========= */

  isDirected() {
    return this.g._isDirected;
  }

  isMultigraph() {
    return this.g._isMultigraph;
  }

  isCompound() {
    return this.g._isCompound;
  }

  isImmutable() {
    return this.g._isImmutable;
  }

  setGraph(label) {
    this.g._label = label;
    return this._getGraph();
  }

  graph() {
    return this.g._label;
  }

  _getGraph() {
    return this.isImmutable() ? new Graph(null, this.g) : this;
  }


  /* === Node functions ========== */

  setDefaultNodeLabel(newDefault) {
    if (!_.isFunction(newDefault)) {
      newDefault = _.constant(newDefault);
    }
    this.g._defaultNodeLabelFn = newDefault;
    return this._getGraph();
  }

  nodeCount() {
    return this._nodeCount;
  }

  nodes() {
    return _.keys(this.g._nodes);
  }

  sources() {
    return _.filter(this.nodes(), _.bind(function (v) {
      return _.isEmpty(this.g._in[v]);
    }, this));
  }

  sinks() {
    return _.filter(this.nodes(), _.bind(function (v) {
      return _.isEmpty(this.g._out[v]);
    }, this));
  }

  setNodes(vs, value) {
    var args = arguments;
    _.forEach(vs, _.bind(function (v) {
      if (args.length > 1) {
        this.setNode(v, value);
      } else {
        this.setNode(v);
      }
    }, this));
    return this._getGraph();
  }

  setNode(v, value) {
    if (_.has(this.g._nodes, v)) {
      if (arguments.length > 1) {
        this.g._nodes[v] = value;
      }
      return this._getGraph();
    }

    this.g._nodes[v] = arguments.length > 1 ? value : this.g._defaultNodeLabelFn(v);
    if (this.g._isCompound) {
      this.g._parent[v] = GRAPH_NODE;
      this.g._children[v] = {};
      this.g._children[GRAPH_NODE][v] = true;
    }
    this.g._in[v] = {};
    this.g._preds[v] = {};
    this.g._out[v] = {};
    this.g._sucs[v] = {};
    ++this._nodeCount;
    return this._getGraph();
  }

  node = (v) => {
    return this.g._nodes[v];
  }

  hasNode(v) {
    return _.has(this.g._nodes, v);
  }

  removeNode(v) {
    var self = this;
    if (_.has(this.g._nodes, v)) {
      var removeEdge = function (e) {
        self.removeEdge(self._edgeObjs[e]);
      };
      delete this.g._nodes[v];
      if (this.g._isCompound) {
        this._removeFromParentsChildList(v);
        delete this.g._parent[v];
        _.forEach(this.children(v), _.bind(function (child) {
          this.setParent(child);
        }, this));
        delete this.g._children[v];
      }
      _.forEach(_.keys(this.g._in[v]), removeEdge);
      delete this.g._in[v];
      delete this.g._preds[v];
      _.forEach(_.keys(this.g._out[v]), removeEdge);
      delete this.g._out[v];
      delete this.g._sucs[v];
      --this._nodeCount;
    }
    return this._getGraph();
  }

  setParent(v, parent) {
    if (!this.g._isCompound) {
      throw new Error("Cannot set parent in a non-compound graph");
    }

    if (_.isUndefined(parent)) {
      parent = GRAPH_NODE;
    } else {
      // Coerce parent to string
      parent += "";
      for (var ancestor = parent; !_.isUndefined(ancestor); ancestor = this.parent(ancestor)) {
        if (ancestor === v) {
          throw new Error("Setting " + parent + " as parent of " + v +
            " would create create a cycle");
        }
      }

      this.setNode(parent);
    }

    this.setNode(v);
    this._removeFromParentsChildList(v);
    this.g._parent[v] = parent;
    this.g._children[parent][v] = true;
    return this._getGraph();
  }

  _removeFromParentsChildList(v) {
    delete this.g._children[this.g._parent[v]][v];
  }

  parent(v) {
    if (this.g._isCompound) {
      var parent = this.g._parent[v];
      if (parent !== GRAPH_NODE) {
        return parent;
      }
    }
  }

  children(v) {
    if (_.isUndefined(v)) {
      v = GRAPH_NODE;
    }

    if (this.g._isCompound) {
      var children = this.g._children[v];
      if (children) {
        return _.keys(children);
      }
    } else if (v === GRAPH_NODE) {
      return this.nodes();
    } else if (this.hasNode(v)) {
      return [];
    }
  }

  predecessors(v) {
    var predsV = this.g._preds[v];
    if (predsV) {
      return _.keys(predsV);
    }
  }

  successors(v) {
    var sucsV = this.g._sucs[v];
    if (sucsV) {
      return _.keys(sucsV);
    }
  }

  neighbors(v) {
    var preds = this.predecessors(v);
    if (preds) {
      return _.union(preds, this.successors(v));
    }
  }

  isLeaf(v) {
    var neighbors;
    if (this.isDirected()) {
      neighbors = this.successors(v);
    } else {
      neighbors = this.neighbors(v);
    }
    return neighbors.length === 0;
  }

  filterNodes(filter) {
    var copy = new this.constructor({
      directed: this.g._isDirected,
      multigraph: this.g._isMultigraph,
      compound: this.g._isCompound
    });

    copy.setGraph(this.graph());

    _.forEach(this.g._nodes, _.bind(function (value, v) {
      if (filter(v)) {
        copy.setNode(v, value);
      }
    }, this));

    _.forEach(this.g._edgeObjs, _.bind(function (e) {
      if (copy.hasNode(e.v) && copy.hasNode(e.w)) {
        copy.setEdge(e, this.edge(e));
      }
    }, this));

    var self = this;
    var parents = {};

    function findParent(v) {
      var parent = self.parent(v);
      if (parent === undefined || copy.hasNode(parent)) {
        parents[v] = parent;
        return parent;
      } else if (parent in parents) {
        return parents[parent];
      } else {
        return findParent(parent);
      }
    }

    if (this.g._isCompound) {
      _.forEach(copy.nodes(), function (v) {
        copy.setParent(v, findParent(v));
      });
    }

    return copy;
  }

  /* === Edge functions ========== */

  setDefaultEdgeLabel(newDefault) {
    if (!_.isFunction(newDefault)) {
      newDefault = _.constant(newDefault);
    }
    this.g._defaultEdgeLabelFn = newDefault;
    return this._getGraph();
  }

  edgeCount() {
    return this._edgeCount;
  }

  edges() {
    return _.values(this.g._edgeObjs);
  }

  setPath(vs, value) {
    var self = this,
      args = arguments;
    _.reduce(vs, function (v, w) {
      if (args.length > 1) {
        self.setEdge(v, w, value);
      } else {
        self.setEdge(v, w);
      }
      return w;
    });
    return this._getGraph();
  }

  /*
   * setEdge(v, w, [value, [name]])
   * setEdge({ v, w, [name] }, [value])
   */
  setEdge() {
    var v, w, name, value,
      valueSpecified = false,
      arg0 = arguments[0];

    if (typeof arg0 === "object" && arg0 !== null && "v" in arg0) {
      v = arg0.v;
      w = arg0.w;
      name = arg0.name;
      if (arguments.length === 2) {
        value = arguments[1];
        valueSpecified = true;
      }
    } else {
      v = arg0;
      w = arguments[1];
      name = arguments[3];
      if (arguments.length > 2) {
        value = arguments[2];
        valueSpecified = true;
      }
    }

    v = "" + v;
    w = "" + w;
    if (!_.isUndefined(name)) {
      name = "" + name;
    }

    var e = edgeArgsToId(this.g._isDirected, v, w, name);
    if (_.has(this.g._edgeLabels, e)) {
      if (valueSpecified) {
        this.g._edgeLabels[e] = value;
      }
      return this._getGraph();
    }

    if (!_.isUndefined(name) && !this.g._isMultigraph) {
      throw new Error("Cannot set a named edge when isMultigraph = false");
    }

    // It didn't exist, so we need to create it.
    // First ensure the nodes exist.
    this.setNode(v);
    this.setNode(w);

    this.g._edgeLabels[e] = valueSpecified ? value : this.g._defaultEdgeLabelFn(v, w, name);

    var edgeObj = edgeArgsToObj(this.g._isDirected, v, w, name);
    // Ensure we add undirected edges in a consistent way.
    v = edgeObj.v;
    w = edgeObj.w;

    Object.freeze(edgeObj);
    this.g._edgeObjs[e] = edgeObj;
    incrementOrInitEntry(this.g._preds[w], v);
    incrementOrInitEntry(this.g._sucs[v], w);
    this.g._in[w][e] = edgeObj;
    this.g._out[v][e] = edgeObj;
    this._edgeCount++;
    return this._getGraph();
  }

  edge = (v, w, name) => {
    var e = (arguments.length === 1 ?
      edgeObjToId(this.g._isDirected, arguments[0]) :
      edgeArgsToId(this.g._isDirected, v, w, name));
    return this.g._edgeLabels[e];
  }

  hasEdge(v, w, name) {
    var e = (arguments.length === 1 ?
      edgeObjToId(this.g._isDirected, arguments[0]) :
      edgeArgsToId(this.g._isDirected, v, w, name));
    return _.has(this.g._edgeLabels, e);
  }

  removeEdge(v, w, name) {
    var e = (arguments.length === 1 ?
        edgeObjToId(this.g._isDirected, arguments[0]) :
        edgeArgsToId(this.g._isDirected, v, w, name)),
      edge = this.g._edgeObjs[e];
    if (edge) {
      v = edge.v;
      w = edge.w;
      delete this.g._edgeLabels[e];
      delete this.g._edgeObjs[e];
      decrementOrRemoveEntry(this.g._preds[w], v);
      decrementOrRemoveEntry(this.g._sucs[v], w);
      delete this.g._in[w][e];
      delete this.g._out[v][e];
      this._edgeCount--;
    }
    return this._getGraph();
  }

  inEdges(v, u) {
    var inV = this.g._in[v];
    if (inV) {
      var edges = _.values(inV);
      if (!u) {
        return edges;
      }
      return _.filter(edges, function (edge) {
        return edge.v === u;
      });
    }
  }

  outEdges(v, w) {
    var outV = this.g._out[v];
    if (outV) {
      var edges = _.values(outV);
      if (!w) {
        return edges;
      }
      return _.filter(edges, function (edge) {
        return edge.w === w;
      });
    }
  }

  nodeEdges(v, w) {
    var inEdges = this.inEdges(v, w);
    if (inEdges) {
      return inEdges.concat(this.outEdges(v, w));
    }
  }

}

function incrementOrInitEntry(map, k) {
  if (map[k]) {
    map[k]++;
  } else {
    map[k] = 1;
  }
}

function decrementOrRemoveEntry(map, k) {
  if (!--map[k]) {
    delete map[k];
  }
}

function edgeArgsToId(isDirected, v_, w_, name) {
  var v = "" + v_;
  var w = "" + w_;
  if (!isDirected && v > w) {
    var tmp = v;
    v = w;
    w = tmp;
  }
  return v + EDGE_KEY_DELIM + w + EDGE_KEY_DELIM +
    (_.isUndefined(name) ? DEFAULT_EDGE_NAME : name);
}

function edgeArgsToObj(isDirected, v_, w_, name) {
  var v = "" + v_;
  var w = "" + w_;
  if (!isDirected && v > w) {
    var tmp = v;
    v = w;
    w = tmp;
  }
  var edgeObj = {
    v: v,
    w: w
  };
  if (name) {
    edgeObj.name = name;
  }
  return edgeObj;
}

function edgeObjToId(isDirected, edgeObj) {
  return edgeArgsToId(isDirected, edgeObj.v, edgeObj.w, edgeObj.name);
}