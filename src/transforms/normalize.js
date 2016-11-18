
import Normalize from '../utils/normalize'
import warn from '../utils/warn'
import { default as coreSchema } from '../plugins/schema'

/**
 * Normalize the document and selection with the core schema.
 *
 * @param {Transform} transform
 * @return {Transform}
 */

export function normalize(transform) {
  return transform
    .normalizeDocument()
    .normalizeSelection()
}

/**
 * Normalize the document with the core schema.
 *
 * @param {Transform} transform
 * @return {Transform}
 */

export function normalizeDocument(transform) {
  return transform.normalizeWith(coreSchema)
}

/**
 * Normalize state with a `schema`.
 *
 * @param {Transform} transform
 * @param {Schema} schema
 * @return {Transform}
 */

export function normalizeWith(transform, schema) {
  const { state } = transform
  const { document } = state

  // If the schema has no validation rules, there's nothing to normalize.
  if (!schema.hasValidators) {
    return transform
  }

  return transform.normalizeNodeWith(schema, document)
}

/**
 * Normalize a `node` and its children with a `schema`.
 *
 * @param {Transform} transform
 * @param {Schema} schema
 * @param {Node} node
 * @return {Transform}
 */

export function normalizeNodeWith(transform, schema, node) {
  // For performance considerations, we will check if the transform was changed.
  const opCount = transform.operations.length

  // Iterate over its children.
  normalizeChildrenWith(transform, schema, node)

  // Re-find the node reference if necessary.
  if (transform.operations.length != opCount) {
    node = refindNode(transform, node)
  }

  // Now normalize the node itself if it still exists.
  if (node) {
    normalizeNodeOnly(transform, schema, node)
  }

  return transform
}

/**
 * Normalize a `node` and its parents with a `schema`.
 *
 * @param {Transform} transform
 * @param {Schema} schema
 * @param {Node} node
 * @return {Transform}
 */

export function normalizeParentsWith(transform, schema, node) {
  normalizeNodeOnly(transform, schema, node)

  // Normalize went back up to the very top of the document.
  if (node.kind == 'document') {
    return transform
  }

  // Re-find the node first.
  node = refindNode(transform, node)

  if (!node) {
    return transform
  }

  const { state } = transform
  const { document } = state
  const parent = document.getParent(node.key)

  return normalizeParentsWith(transform, schema, parent)
}

/**
 * Normalize a `node` and its children with the core schema.
 *
 * @param {Transform} transform
 * @param {Node|String} key
 * @return {Transform}
 */

export function normalizeNodeByKey(transform, key) {
  key = Normalize.key(key)
  const { state } = transform
  const { document } = state
  const node = document.key == key ? document : document.assertDescendant(key)

  transform.normalizeNodeWith(coreSchema, node)
  return transform
}

/**
 * Normalize a `node` and its parent with the core schema.
 *
 * @param {Transform} transform
 * @param {Node|String} key
 * @return {Transform}
 */

export function normalizeParentsByKey(transform, key) {
  key = Normalize.key(key)
  const { state } = transform
  const { document } = state
  const node = document.key == key ? document : document.assertDescendant(key)

  transform.normalizeParentsWith(coreSchema, node)
  return transform
}

/**
 * Normalize only the selection.
 *
 * @param {Transform} transform
 * @return {Transform}
 */

export function normalizeSelection(transform) {
  let { state } = transform
  let { document, selection } = state
  selection = selection.normalize(document)

  // If the selection is unset, or the anchor or focus key in the selection are
  // pointing to nodes that no longer exist, warn and reset the selection.
  if (
    selection.isUnset ||
    !document.hasDescendant(selection.anchorKey) ||
    !document.hasDescendant(selection.focusKey)
  ) {
    warn('Selection was invalid and reset to start of the document')
    const firstText = document.getFirstText()
    selection = selection.merge({
      anchorKey: firstText.key,
      anchorOffset: 0,
      focusKey: firstText.key,
      focusOffset: 0,
      isBackward: false
    })
  }

  state = state.merge({ selection })
  transform.state = state
  return transform
}

/**
 * Re-find a reference to a node that may have been modified or removed
 * entirely by a transform.
 *
 * @param {Transform} transform
 * @param {Node} node
 * @return {Node}
 */

function refindNode(transform, node) {
  const { state } = transform
  const { document } = state
  return node.kind == 'document'
    ? document
    : document.getDescendant(node.key)
}

/**
 * Normalize the children of a `node` with a `schema`.
 *
 * @param {Transform} transform
 * @param {Schema} schema
 * @param {Node} node
 * @return {Transform}
 */

function normalizeChildrenWith(transform, schema, node) {
  if (node.kind == 'text') return transform

  node.nodes.forEach((child) => {
    transform.normalizeNodeWith(schema, child)
  })

  return transform
}

/**
 * Normalize a `node` with a `schema`, but not its children.
 *
 * @param {Transform} transform
 * @param {Schema} schema
 * @param {Node} node
 * @return {Transform}
 */

function normalizeNodeOnly(transform, schema, node) {
  let max = schema.rules.length
  let iterations = 0

  function iterate(t, n) {
    const failure = n.validate(schema)
    if (!failure) return t

    const { value, rule } = failure

    // Rule the `normalize` function for the rule with the invalid value.
    rule.normalize(t, n, value)

    // Re-find the node reference, in case it was updated. If the node no longer
    // exists, we're done for this branch.
    n = refindNode(t, n)
    if (!n) return t

    // Increment the iterations counter, and check to make sure that we haven't
    // exceeded the max. Without this check, it's easy for the `validate` or
    // `normalize` function of a schema rule to be written incorrectly and for
    // an infinite invalid loop to occur.
    iterations++

    if (iterations > max) {
      throw new Error('A schema rule could not be validated after sufficient iterations. This is usually due to a `rule.validate` or `rule.normalize` function of a schema being incorrectly written, causing an infinite loop.')
    }

    // Otherwise, iterate again.
    return iterate(t, n)
  }

  return iterate(transform, node)
}
