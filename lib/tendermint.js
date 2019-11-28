const tendermint = require('tendermint-node')
const fs = require('fs-extra')
const { join } = require('path')

const genValidator = () => tendermint.genValidator()
const version = () => tendermint.version()

const initTendermint = async ({
    home,
    ports,
    privateKey,
    genesis,
    peers,
    log,
}) => {
    // Set required options
    let opts = {
        rpc: {
            laddr: `tcp://0.0.0.0:${ports.rpc}`,
        },
        p2p: {
            laddr: `tcp://0.0.0.0:${ports.p2p}`,
        },
        proxyApp: `tcp://127.0.0.1:${ports.abci}`,
    }

    // Initialize tendermint config in the home directory
    await tendermint.init(home)

    // if a custom private key is provided, use it
    if (privateKey) {
        if (!(await fs.exists(privateKey))) {
            throw new Error(`Invalid private key provided at ${keyPath}.`)
        }

        let defaultPath = join(home, 'config', 'priv_validator_key.json')

        let newValidator = await fs.readJson(privateKey)
        let oldValidator = await fs.readJson(defaultPath)

        if (newValidator.pub_key.value !== oldValidator.pub_key.value) {
            await fs.copy(privateKey, defaultPath)
        }
    }

    // use a custom genesis file if it's provided
    if (genesis) {
        if (!(await fs.exists(genesis))) {
            throw new Error(`Invalid genesis file provided at ${genesis}.`)
        }

        await fs.copy(genesis, join(home, 'config', 'genesis.json'))
    }

    // add peers to persistentPeers
    if (peers && peers.length > 0) {
        let shouldUseAuth = false

        peers.forEach(peer => {
            if (peer.indexOf('@') !== -1) {
                shouldUseAuth = true
            }
        })

        if (!shouldUseAuth) {
            let cfgPath = join(home, 'config', 'config.toml')
            let configToml = fs.readFileSync(cfgPath, 'utf8')

            configToml = configToml.replace(
                'auth_enc = true',
                'auth_enc = false'
            )

            fs.writeFileSync(cfgPath, configToml)

            const bogusId = '0000000000000000000000000000000000000000'
            peers.forEach((peer, index) => {
                if (peer.indexOf('@') === -1) {
                    peers[index] = [bogusId, peer].join('@')
                }
            })
        }

        opts.p2p.persistentPeers = peers.join(',')
    }

    let killed = false

    let tendermintProcess = tendermint.node(home, opts)

    if (log) {
        tendermintProcess.stdout.pipe(process.stdout)
        tendermintProcess.stderr.pipe(process.stderr)
    }

    tendermintProcess.then(() => {
        if (killed) {
            return
        }

        throw new Error('Tendermint exited unexpectedly.')
    })

    await tendermintProcess.synced()

    return {
        kill() {
            killed = true

            tendermintProcess.kill()
        },
    }
}

module.exports = {
    initTendermint,
    version,
    genValidator,
}
