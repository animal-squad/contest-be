const express = require('express');
const router = express.Router();

router.post('/send', async (req, res) => {
    try {
        console.log('Received message delivery request:', req.body);
        const { messageData } = req.body;

        if(!messageData || !messageData.recipients || !messageData.content ){
            return res.status(400).json({
                success: false,
                message: '잘못된 메시지 형식입니다.'
            });
        }

        const io = req.app.get('io');
        console.log('Got Socket.IO instance:', !!io);
        const deliveryResults = await deliverMessageToRecipients(io, messageData);

        res.status(200).json({
            success: true,
            delivered: deliveryResults
        });
    } catch (error) {
        console.error('Message notification error:', error);
        res.status(500).json({
            success: false,
            message: '메시지 전달 중 오류가 발생했습니다.'
        });
    }
})

async function deliverMessageToRecipients(io, messageData) {
    const deliveryResults = [];
    const connectedSockets = await io.fetchSockets();


    for (const recipientId of messageData.recipients) {
        const recipientSocket = connectedSockets.find(socket =>
            socket.user && socket.user.id === recipientId
        );

        if (recipientSocket) {
            recipientSocket.emit('chatMessage', {
                content: messageData.content,
                sender: messageData.sender,
                type: messageData.type,
                timestamp: messageData.timestamp,
                room: messageData.room
            });

            deliveryResults.push({
                userId: recipientId,
                delivered: true
            });
        } else {
            deliveryResults.push({
                userId: recipientId,
                delivered: false,
                reason: 'User not connected'
            });
        }
    }

    return deliveryResults;
}

module.exports = router;