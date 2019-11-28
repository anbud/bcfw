const { createHash } = require('crypto')
const djson = require('deterministic-json')
const muta = require('muta')

const valid = {
    empty: new Set(['init']),
    init: new Set(['startBlock']),
    startBlock: new Set(['tx', 'block']),
    tx: new Set(['tx', 'block']),
    block: new Set(['commit']),
    commit: new Set(['startBlock']),
}

const protectValidators = validators => {
    return new Proxy(validators, {
        set(target, prop, value) {
            if (Buffer.from(prop, 'base64').length !== 32) {
                throw new Error('Invalid validator public key length')
            }
            return Reflect.set(target, prop, value)
        },
    })
}

const StateMachine = opts => {
    let initHandlers = []
    let blockHandlers = []
    let txHandlers = []

    let appMethods = {
        handleBlock: blockHandler => blockHandlers.push(blockHandler),
        handleTx: txHandler => txHandlers.push(txHandler),
        handleInit: init => initHandlers.push(init),

        compile(appState = {}) {
            Object.assign(appState, opts.initialState || {})
            let mempoolState = muta(appState)

            let nextState, nextValidators, nextContext
            let chainValidators, mempoolValidators, mempoolContext

            let prev = 'empty'

            const applyTx = (state, tx, context) => {
                let txState = muta(state)
                let txValidators = muta(context.validators)

                txValidators = protectValidators(txValidators)

                context = Object.assign({}, context, {
                    validators: txValidators,
                })

                try {
                    txHandlers.forEach(m => m(txState, tx, context))

                    if (
                        muta.wasMutated(txState) ||
                        muta.wasMutated(txValidators)
                    ) {
                        muta.commit(txState)
                        muta.commit(txValidators)

                        return {}
                    } else {
                        throw new Error(
                            'Valid transaction have to mutate state or validators.'
                        )
                    }
                } catch (e) {
                    throw e
                }
            }

            const checkTransition = type => {
                if (!valid[prev].has(type)) {
                    throw Error(
                        `Invalid transition for params {type: ${type}, prev: ${prevOp}}.`
                    )
                }

                prev = type
            }

            return {
                init: (initialState, initialContext = {}, resuming = false) => {
                    checkTransition('init')

                    nextContext = initialContext
                    chainValidators = initialContext.validators || {}
                    chainValidators = protectValidators(chainValidators)

                    mempoolValidators = muta(chainValidators)
                    mempoolValidators = protectValidators(mempoolValidators)

                    Object.assign(appState, initialState)

                    if (!resuming) {
                        initHandlers.forEach(m => m(appState, nextContext))
                    }
                },
                transition: action => {
                    checkTransition(action.type)

                    if (action.type === 'tx') {
                        applyTx(nextState, action.data, nextContext)
                    } else if (action.type === 'block') {
                        blockHandlers.forEach(m => m(nextState, nextContext))
                    } else if (action.type === 'startBlock') {
                        nextState = muta(appState)
                        nextValidators = muta(chainValidators)
                        nextValidators = protectValidators(nextValidators)

                        nextContext = Object.assign({}, action.data, {
                            validators: nextValidators,
                        })
                    }
                },
                commit: () => {
                    checkTransition('commit')

                    muta.commit(nextState)
                    muta.commit(nextValidators)

                    mempoolState = muta(appState)
                    mempoolValidators = muta(chainValidators)
                    mempoolValidators = protectValidators(mempoolValidators)
                },
                check: tx => {
                    applyTx(
                        mempoolState,
                        tx,
                        Object.assign({}, nextContext, {
                            validators: mempoolValidators,
                        })
                    )
                },
                query: path => {
                    return appState
                },
                context: () => {
                    return nextContext
                },
            }
        },
    }

    return appMethods
}

module.exports = StateMachine
