const { Kafka, Partitioners } = require('kafkajs');
const sessionService = require('./sessionService');

class KafkaService {
    constructor() {
        this.kafka = new Kafka({
            clientId: 'chat-service',
            brokers: process.env.KAFKA_BROKERS?.split(',')
        });

        this.producer = this.kafka.producer({
            createPartitioner: Partitioners.LegacyPartitioner,
            allowAutoTopicCreation: true
        });
    }

    async init() {
        try {
            // Producer 연결
            await this.producer.connect();
            console.log('Kafka producer connected');
        } catch (error) {
            console.error('Kafka initialization error:', error);
            throw error;
        }
    }

    // Producer: 메시지 발행
    async publishMessage(message) {
        try {
            await this.producer.send({ //브로커에 전송, 성공시 resolve 실패시 reject
                topic: 'chat.messages',
                messages: [{
                    key: message.room,
                    value: JSON.stringify({
                        messageId: message.messageId,
                        content: message.content,
                        type: message.type,
                        sender: message.sender,
                        room: message.room,
                        recipients: message.recipients,
                        timestamp: new Date().toISOString()
                    })
                }]
            });
            console.log('producer가 메세지 발행에 성공:', {
                room: message.room,
                messageId: message.messageId
            });

        } catch (error) {
            console.error('메세지 발행 실패:', error);
            throw error;
        }
    }

       async disconnect() {
        try {
            await this.producer.disconnect();
            console.log('Kafka disconnected');
        } catch (error) {
            console.error('Kafka disconnect error:', error);
        }
    }
}

module.exports = KafkaService;