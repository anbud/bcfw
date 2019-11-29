const djson = require('deterministic-json')
const vstruct = require('varstruct')

const { createHash } = require('crypto')
const fs = require('fs-extra')
const { join } = require('path')
const createServer = require('abci')
const merk = require('merk')

const buildInitialInfo = initChainreq => {
    let result = {
        validators: {},
    }

    initChainreq.validators.forEach(validator => {
        result.validators[
            validator.pubKey.data.toString('base64')
        ] = validator.power.toNumber()
    })

    return result
}

const TxStruct = vstruct([
    { name: 'data', type: vstruct.VarString(vstruct.UInt32BE) },
    { name: 'nonce', type: vstruct.UInt32BE },
])

const decodeTx = txBuffer => djson.parse(TxStruct.decode(txBuffer).data)

const createABCIServer = (state, stateMachine, initialState, appHome) => {
    let stateFilePath = join(appHome, 'prev-state.json')

    let height = 0

    let abciServer = createServer({
        info: async req => {
            let stateExists = await fs.pathExists(stateFilePath)

            if (stateExists) {
                let stateFile

                try {
                    stateFile = JSON.parse(
                        await fs.readFile(stateFilePath, 'utf8')
                    )
                } catch (err) {
                    console.log(
                        "Previous state doesn't exist. Replaying chain."
                    )

                    return {}
                }

                let rootHash = merk.hash(state)

                if (stateFile.rootHash !== rootHash) {
                    console.log('Root hash mismatch. Replaying chain.')

                    return {}
                }

                stateMachine.init(
                    null,
                    { validators: stateFile.validators || {} },
                    true
                )

                height = stateFile.height

                return {
                    lastBlockAppHash: rootHash,
                    lastBlockHeight: stateFile.height,
                }
            } else {
                return {}
            }
        },
        deliverTx: req => {
            try {
                try {
                    stateMachine.transition({
                        type: 'tx',
                        data: decodeTx(req.tx),
                    })

                    return {}
                } catch (e) {
                    return {
                        code: 1,
                        log: e.toString(),
                    }
                }
            } catch (e) {
                return {
                    code: 1,
                    log: 'Invalid transaction encoding.',
                }
            }
        },
        checkTx: req => {
            try {
                try {
                    stateMachine.check(decodeTx(req.tx))

                    return {}
                } catch (e) {
                    return {
                        code: 1,
                        log: e.toString(),
                    }
                }
            } catch (e) {
                return {
                    code: 1,
                    log: 'Invalid transaction encoding.',
                }
            }
        },
        beginBlock: req => {
            merk.rollback(state)

            let time = req.header.time.seconds.toNumber()

            stateMachine.transition({ type: 'startBlock', data: { time } })

            return {}
        },
        endBlock: () => {
            stateMachine.transition({ type: 'block', data: {} })

            let { validators } = stateMachine.context()
            let validatorUpdates = []

            for (let pubKey in validators) {
                validatorUpdates.push({
                    pubKey: {
                        type: 'ed25519',
                        data: Buffer.from(pubKey, 'base64'),
                    },
                    power: { low: validators[pubKey], high: 0 },
                })
            }

            return {
                validatorUpdates,
            }
        },
        commit: async () => {
            stateMachine.commit()
            height++

            let newStateFilePath = join(appHome, `state.json`)

            if (await fs.pathExists(newStateFilePath)) {
                await fs.move(newStateFilePath, stateFilePath, {
                    overwrite: true,
                })
            }

            await merk.commit(state)
            let rootHash = null

            try {
                rootHash = merk.hash(state)
            } catch (err) {}

            await fs.writeFile(
                newStateFilePath,
                JSON.stringify({
                    height: height,
                    rootHash: rootHash,
                    validators: stateMachine.context().validators,
                })
            )

            return {
                data: rootHash ? Buffer.from(rootHash, 'hex') : Buffer.alloc(0),
            }
        },
        initChain: async req => {
            let initialInfo = buildInitialInfo(req)

            stateMachine.init(initialState, initialInfo)

            await merk.commit(state)

            return {}
        },
        query: async req => {
            try {
                merk.hash(state)
            } catch (err) {
                return { value: Buffer.from('null'), height }
            }

            let path = req.path
            let proof = null
            let proofHeight = height

            proof = await merk.proof(state, path)
            let proofJSON = JSON.stringify(proof)
            let proofBytes = Buffer.from(proofJSON)

            return {
                value: proofBytes,
                height: proofHeight,
            }
        },
    })

    return abciServer
}

module.exports = createABCIServer
