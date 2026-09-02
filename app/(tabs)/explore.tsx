import React from 'react';
import { View, Button, Alert, StyleSheet } from 'react-native';
import SendSMS from 'react-native-sms';

export default function App() {

  const sendMessage = () => {
    const phoneNumber = '7990267752';
    const message = 'Hello! This is a message from my app.';

    SendSMS.send(
      {
        body: message,
        recipients: [phoneNumber],
        successTypes: ['all'],
        allowAndroidSendWithoutReadPermission: true,
      },
      (completed, cancelled, error) => {
        if (completed) {
          Alert.alert('Success', 'Message sent successfully');
        } else if (cancelled) {
          Alert.alert('Cancelled', 'Message was cancelled');
        } else if (error) {
          Alert.alert('Error', 'Failed to send message');
        }
      }
    );
  };

  return (
    <View style={styles.button}>
      <Button
        title="SEND MESSAGE"
        onPress={sendMessage}
      />
    </View>
  );
}

const styles=StyleSheet.create({
  button:{
    paddingTop:100
  }
})