const { join } = require('path')
const { homedir } = require('os')

const createABCIServer = require('./lib/abci')
const { initTendermint } = require('./lib/tendermint')
const createStateMachine = require('./lib/stateMachine')

const { randomBytes, createHash } = require('crypto')
const fs = require('fs-extra')
const DJSON = require('deterministic-json')
const level = require('level')
const merk = require('merk')

class BCFW {
    constructor(config) {
        this.application = createStateMachine(config)

        this.ports = config.ports

        this.log = config.log || false
        this.initialState = config.initialState
        this.privateKey = config.privateKey
        this.genesis = config.genesis
        this.peers = config.peers || []
        this.appHome = join(homedir(), '.bcfw', 'networks')

        this.setHome()

        Object.assign(this, this.application)
    }

    getAppInfo() {
        return {
            ports: this.ports,
            GCI: this.GCI,
            genesis: this.genesis,
            home: this.home,
        }
    }

    setGenesis() {
        if (!this.genesis) {
            this.genesis = join(this.home, 'config', 'genesis.json')
        }

        let genesisJSON = fs.readFileSync(this.genesis, 'utf8')

        this.genesis = DJSON.stringify(JSON.parse(genesisJSON))
    }

    setHome() {
        if (this.genesis && this.privateKey) {
            this.home = join(
                this.appHome,
                createHash('sha256')
                    .update(fs.readFileSync(this.genesis))
                    .update(fs.readFileSync(this.privateKey))
                    .digest('hex')
            )
        } else if (this.genesis && !this.privateKey) {
            this.home = join(
                this.appHome,
                createHash('sha256')
                    .update(fs.readFileSync(this.genesis))
                    .digest('hex')
            )
        } else {
            this.home = join(this.appHome, randomBytes(16).toString('hex'))
        }
    }

    async start() {
        await fs.mkdirp(this.home)

        this.db = level(join(this.home, 'state.db'))
        this.state = await merk(this.db)

        this.stateMachine = this.application.compile(this.state)

        this.abciServer = createABCIServer(
            this.state,
            this.stateMachine,
            this.initialState,
            this.home
        )
        this.abciServer.listen(this.ports.abci)

        this.tendermintProcess = await createTendermintProcess({
            home: this.home,
            ports: this.ports,
            privateKey: this.privateKey,
            genesis: this.genesis,
            peers: this.peers,
            log: this.log,
        })

        this.setGenesis()

        return this.getAppInfo()
    }
}

let App = config => new BCFW(config)

const middleware = config => {
    let app = App(config)
    console.log(app)

    return (req, res, next) => {
        console.log(req)

        next()
    }
}

module.exports = middleware
