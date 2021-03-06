/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails oncall+relay
 */

'use strict';

require('configureForRelayOSS');

jest
  .dontMock('GraphQLRange')
  .dontMock('GraphQLSegment')
  .mock('warning');

const Relay = require('Relay');
const RelayConnectionInterface = require('RelayConnectionInterface');
const RelayQueryTracker = require('RelayQueryTracker');
const RelayRecordStore = require('RelayRecordStore');
const RelayRecordWriter = require('RelayRecordWriter');
const RelayTestUtils = require('RelayTestUtils');

const diffRelayQuery = require('diffRelayQuery');

describe('diffRelayQuery', () => {
  var {getNode, getVerbatimNode, writePayload} = RelayTestUtils;
  var HAS_NEXT_PAGE, HAS_PREV_PAGE, PAGE_INFO;

  var rootCallMap;

  beforeEach(() => {
    jest.resetModuleRegistry();

    ({HAS_NEXT_PAGE, HAS_PREV_PAGE, PAGE_INFO} = RelayConnectionInterface);

    rootCallMap = {
      'viewer': {'': 'client:1'},
    };

    jasmine.addMatchers(RelayTestUtils.matchers);
  });

  it('returns unfetched connections as-is', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var tracker = new RelayQueryTracker();

    var query = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `);
    var diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(1);
    expect(diffQueries[0]).toBeQueryRoot(query);
  });

  it('removes completely fetched connections', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    var payload = {
      viewer: {
        newsFeed: {
          edges: [
            {cursor: 'c1', node: {id: 's1'}},
            {cursor: 'c2', node: {id: 's2'}},
            {cursor: 'c3', node: {id: 's3'}},
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    var query = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `);
    // Write full data for all 3 items
    writePayload(store, writer, query, payload, tracker);

    // Everything can be diffed out
    var diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(0);
  });

  it('returns range extensions for partially fetched connections', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    // Write full data for 3 of 5 records, nothing for edges 4-5
    var payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                id: 's1',
                __typename: 'Story',
              },
            },
            {
              cursor: 'c2',
              node: {
                id: 's2',
                __typename: 'Story',
              },
            },
            {
              cursor: 'c3',
              node: {
                id: 's3',
                __typename: 'Story',
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    var query = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"5") {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `);
    writePayload(store, writer, query, payload, tracker);

    // Nothing to fetch for records 1-3, fetch extension of range for 4-5
    var diffQueries = diffRelayQuery(query, store, tracker);
    expect(diffQueries.length).toBe(1);
    expect(diffQueries[0]).toEqualQueryRoot(getNode(Relay.QL`
      query {
        viewer {
          newsFeed(after:"c3",first:$count) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `, {
      count: 2,
    }));
  });

  it('does not fetch missing `edges` data for generated `node` ids', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    // Provide empty IDs to simulate non-refetchable nodes
    var writeQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    var payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                __typename: 'Story',
                message: {text: 's1'},
              },
            },
            {
              cursor: 'c2',
              node: {
                __typename: 'Story',
                message: {text: 's2'},
              },
            },
            {
              cursor: 'c3',
              node: {
                __typename: 'Story',
                message: {text: 's3'},
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    writePayload(store, writer, writeQuery, payload, tracker);

    // @relay(isConnectionWithoutNodeID: true) should silence the warning.
    var fetchQueryA = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first: "3") @relay(isConnectionWithoutNodeID: true) {
            edges {
              node {
                feedback {
                  id
                }
              }
            }
          }
        }
      }
    `);
    var diffQueries = diffRelayQuery(fetchQueryA, store, tracker);
    expect(diffQueries.length).toBe(0);
    expect([
      'RelayDiffQueryBuilder: Field `node` on connection `%s` cannot be ' +
      'retrieved if it does not have an `id` field. If you expect fields ' +
      'to be retrieved on this field, add an `id` field in the schema. ' +
      'If you choose to ignore this warning, you can silence it by ' +
      'adding `@relay(isConnectionWithoutNodeID: true)` to the ' +
      'connection field.',
      'newsFeed',
    ]).toBeWarnedNTimes(0);

    // `feedback{id}` is missing but there is no way to refetch it
    // Warn that data cannot be refetched
    var fetchQueryB = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                feedback {
                  id
                }
              }
            }
          }
        }
      }
    `);
    diffRelayQuery(fetchQueryB, store, tracker);

    expect([
      'RelayDiffQueryBuilder: Field `node` on connection `%s` cannot be ' +
      'retrieved if it does not have an `id` field. If you expect fields ' +
      'to be retrieved on this field, add an `id` field in the schema. ' +
      'If you choose to ignore this warning, you can silence it by ' +
      'adding `@relay(isConnectionWithoutNodeID: true)` to the ' +
      'connection field.',
      'newsFeed',
    ]).toBeWarnedNTimes(3);
  });

  it('does not warn about unrefetchable `edges` when there is no missing data', () => {
    const records = {};
    const store = new RelayRecordStore({records}, {rootCallMap});
    const writer = new RelayRecordWriter(records, rootCallMap, false);
    const tracker = new RelayQueryTracker();

    // Provide empty IDs to simulate non-refetchable nodes
    const writeQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    const payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                __typename: 'Story',
                message: {text: 's1'},
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    writePayload(store, writer, writeQuery, payload, tracker);

    // `message{text}` available in the store.
    // Does not warn that data cannot be refetched sine no data is missing.
    const fetchQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    const diffQueries = diffRelayQuery(fetchQuery, store, tracker);
    expect(diffQueries.length).toBe(0);
    expect([
      'RelayDiffQueryBuilder: Field `node` on connection `%s` cannot be ' +
      'retrieved if it does not have an `id` field. If you expect fields ' +
      'to be retrieved on this field, add an `id` field in the schema. ' +
      'If you choose to ignore this warning, you can silence it by ' +
      'adding `@relay(isConnectionWithoutNodeID: true)` to the ' +
      'connection field.',
      'newsFeed',
    ]).toBeWarnedNTimes(0);
  });

  it('fetches split queries under unrefetchable `edges`', () => {
    const records = {};
    const store = new RelayRecordStore({records}, {rootCallMap});
    const writer = new RelayRecordWriter(records, rootCallMap, false);
    const tracker = new RelayQueryTracker();

    // Provide empty IDs to simulate non-refetchable nodes
    const writeQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              node {
                feedback {
                  id,
                  comments(first:"1") {
                    edges {
                      node {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                __typename: 'Story',
                feedback: {
                  __typename: 'Feedback',
                  id: 'feedbackid',
                  comments: {
                    edges: [
                      {
                        cursor: 'commentcurser1',
                        node: {
                          __typename: 'Comment',
                          id: 'commentid',
                        },
                      },
                    ],
                    [PAGE_INFO]: {
                      [HAS_NEXT_PAGE]: true,
                      [HAS_PREV_PAGE]: false,
                    },
                  },
                },
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    writePayload(store, writer, writeQuery, payload, tracker);

    // Missing the `body{text}` on comment.
    const fetchQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              node {
                feedback {
                  id,
                  comments(first:"1") {
                    edges {
                      node {
                        id,
                        body {text}
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    const diffQueries = diffRelayQuery(fetchQuery, store, tracker);
    expect(diffQueries.length).toBe(1);
    expect(diffQueries[0]).toEqualQueryRoot(getNode(Relay.QL`
      query {
        node(id:"commentid"){
          __typename,
          ... on Comment {id, body {text}}
        }
      }
    `));
    expect([
      'RelayDiffQueryBuilder: Field `node` on connection `%s` cannot be ' +
      'retrieved if it does not have an `id` field. If you expect fields ' +
      'to be retrieved on this field, add an `id` field in the schema. ' +
      'If you choose to ignore this warning, you can silence it by ' +
      'adding `@relay(isConnectionWithoutNodeID: true)` to the ' +
      'connection field.',
      'newsFeed',
    ]).toBeWarnedNTimes(0);
  });

  it('fetches missing `node` data via a `node()` query', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    var payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                id: 's1',
                __typename: 'Story',
                message: {text: 's1'},
              },
            },
            {
              cursor: 'c2',
              node: {
                id: 's2',
                __typename: 'Story',
                message: {text: 's2'},
              },
            },
            {
              cursor: 'c3',
              node: {
                id: 's3',
                __typename: 'Story',
                message: {text: 's3'},
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    var writeQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    writePayload(store, writer, writeQuery, payload, tracker);

    // Split one `node()` query per edge to fetch missing `feedback{id}`
    var fetchQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                feedback {
                  id
                }
              }
            }
          }
        }
      }
    `);
    var diffQueries = diffRelayQuery(fetchQuery, store, tracker);
    expect(diffQueries.length).toBe(3);
    expect(diffQueries[0]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s1") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[1]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s2") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[2]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s3") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
  });

  it('fetches missing `node` data via a `node()` query and missing `edges` ' +
     'data via a `connection.find()` query if connection is findable', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    var payload = {
      viewer: {
        newsFeed: {
          edges: [
            {
              cursor: 'c1',
              node: {
                id: 's1',
                __typename: 'Story',
                message: {text: 's1'},
              },
            },
            {
              cursor: 'c2',
              node: {
                id: 's2',
                __typename: 'Story',
                message: {text: 's2'},
              },
            },
            {
              cursor: 'c3',
              node: {
                id: 's3',
                __typename: 'Story',
                message: {text: 's3'},
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    var writeQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    writePayload(store, writer, writeQuery, payload, tracker);

    // node: `feedback{id}` is missing (fetch via node() query)
    // edges: `sortKey` is missing (fetch via .find() query)
    var fetchQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"3") {
            edges {
              sortKey,
              node {
                id,
                __typename,
                feedback {
                  id
                }
              }
            }
          }
        }
      }
    `);
    var diffQueries = diffRelayQuery(fetchQuery, store, tracker);
    expect(diffQueries.length).toBe(6);
    expect(diffQueries[0]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s1") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[1]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        viewer {
          newsFeed(find:"s1") {
            edges {
              cursor,
              node {
                id
                __typename,
              },
              sortKey,
            }
          }
        }
      }
    `));
    expect(diffQueries[2]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s2") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[3]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        viewer {
          newsFeed(find:"s2") {
            edges {
              cursor,
              node {
                id
                __typename,
              },
              sortKey,
            }
          }
        }
      }
    `));
    expect(diffQueries[4]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s3") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[5]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        viewer {
          newsFeed(find:"s3") {
            edges {
              cursor,
              node {
                id,
                __typename,
              },
              sortKey,
            }
          }
        }
      }
    `));

    // Ensure that a `__typename` field is generated
    var typeField = diffQueries[5]
      .getFieldByStorageKey('newsFeed')
      .getFieldByStorageKey('edges')
      .getFieldByStorageKey('node')
      .getFieldByStorageKey('__typename');
    expect(typeField).toBeTruthy();
  });

  it('fetches missing `node` data via a `node()` query and warns about ' +
     'unfetchable `edges` data if connection is not findable', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    var payload = {
      viewer: {
        notificationStories: {
          edges: [
            {
              cursor: 'c1',
              node: {
                id: 's1',
                __typename: 'Story',
                message: {text: 's1'},
              },
            },
            {
              cursor: 'c2',
              node: {
                id: 's2',
                __typename: 'Story',
                message: {text: 's2'},
              },
            },
            {
              cursor: 'c3',
              node: {
                id: 's3',
                __typename: 'Story',
                message: {text: 's3'},
              },
            },
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    var writeQuery = getNode(Relay.QL`
      query {
        viewer {
          notificationStories(first:"3") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    writePayload(store, writer, writeQuery, payload, tracker);

    // node: `feedback{id}` is missing (fetch via node() query)
    // edges: `showBeeper` is missing but cannot be refetched because
    // `notificationStories` does not support `.find()`
    var fetchQuery = getNode(Relay.QL`
      query {
        viewer {
          notificationStories(first:"3") {
            edges {
              showBeeper,
              node {
                feedback {
                  id
                }
              }
            }
          }
        }
      }
    `);
    var diffQueries = diffRelayQuery(fetchQuery, store, tracker);
    expect(diffQueries.length).toBe(3);
    expect(diffQueries[0]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s1") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[1]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s2") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect(diffQueries[2]).toEqualQueryRoot(getVerbatimNode(Relay.QL`
      query {
        node(id:"s3") {
          id,
          __typename,
          ... on FeedUnit {
            feedback {
              id,
            },
            id,
            __typename,
          },
        }
      }
    `));
    expect([
      'RelayDiffQueryBuilder: connection `edges{*}` fields can only be ' +
      'refetched if the connection supports the `find` call. Cannot ' +
      'refetch data for field `%s`.',
      'notificationStories',
    ]).toBeWarnedNTimes(3);
  });

  it('does not flatten fragments when creating new root queries', () => {
    var records = {};
    var store = new RelayRecordStore({records}, {rootCallMap});
    var writer = new RelayRecordWriter(records, rootCallMap, false);
    var tracker = new RelayQueryTracker();

    var payload = {
      viewer: {
        newsFeed: {
          edges: [
            {cursor: 'c1', node: {id:'s1', message:{text:'s1'}}},
          ],
          [PAGE_INFO]: {
            [HAS_NEXT_PAGE]: true,
            [HAS_PREV_PAGE]: false,
          },
        },
      },
    };
    var writeQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              node {
                message {
                  text
                }
              }
            }
          }
        }
      }
    `);
    writePayload(store, writer, writeQuery, payload, tracker);

    // node: `feedback{id}` is missing (fetch via node() query)
    // edges: `sortKey` is missing (fetch via .find() query)
    var edgeFragment = Relay.QL`fragment on NewsFeedEdge{sortKey}`;
    var nodeFragment = Relay.QL`fragment on FeedUnit{feedback{id}}`;
    var fetchQuery = getNode(Relay.QL`
      query {
        viewer {
          newsFeed(first:"1") {
            edges {
              ${edgeFragment},
              node {
                ${nodeFragment},
              },
            }
          }
        }
      }
    `);
    // skip flattening to check fragment structure
    var diffQueries = diffRelayQuery(fetchQuery, store, tracker);
    expect(diffQueries[0]).toContainQueryNode(getNode(nodeFragment));
    expect(diffQueries[1]).toContainQueryNode(getNode(edgeFragment));
  });
});
