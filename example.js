const bcfw = require('./index')
const express = require('express')

const app = express()

app.use(
    bcfw({
        ports: {
            abci: '1234',
            rpc: '8999',
            p2p: '8998',
        },
        initialState: {
            nothing: 0,
        },
    })
)

app.get('/', (req, res) => res.send('Test.'))

app.listen(process.env.PORT || 3500)
