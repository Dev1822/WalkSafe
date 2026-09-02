import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Contacts from "expo-contacts";
import * as SMS from "expo-sms";

export default function WalkSafe() {
  const [permission, setPermission] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState([]);
  const [sending, setSending] = useState(false);

  // Ask for contacts permission when the screen loads
  useEffect(() => {
    requestContactPermission();
  }, []);

  const requestContactPermission = async () => {
    try {
      const { status } =
        await Contacts.requestPermissionsAsync();

      if (status === "granted") {
        setPermission(true);
      } else {
        setPermission(false);

        Alert.alert(
          "Permission Required",
          "WalkSafe needs access to your contacts so you can select emergency contacts."
        );
      }
    } catch (error) {
      console.log("Permission error:", error);
    }
  };

  // Add an emergency contact
  const addEmergencyContact = async () => {
    try {
      if (!permission) {
        await requestContactPermission();
        return;
      }

      const contact =
        await Contacts.presentContactPickerAsync();

      // User cancelled the picker
      if (!contact) {
        return;
      }

      const phoneNumber =
        contact.phoneNumbers?.[0]?.number;

      if (!phoneNumber) {
        Alert.alert(
          "No Phone Number",
          "This contact does not have a phone number."
        );
        return;
      }

      // Prevent duplicate contacts
      const alreadyAdded = emergencyContacts.some(
        (item) => item.id === contact.id
      );

      if (alreadyAdded) {
        Alert.alert(
          "Already Added",
          `${contact.name} is already an emergency contact.`
        );
        return;
      }

      // Add selected contact
      setEmergencyContacts((previousContacts) => [
        ...previousContacts,
        contact,
      ]);
    } catch (error) {
      console.log("Contact picker error:", error);

      Alert.alert(
        "Error",
        "Unable to select the contact."
      );
    }
  };

  // Remove emergency contact
  const removeEmergencyContact = (contactId) => {
    Alert.alert(
      "Remove Emergency Contact",
      "Do you want to remove this person from WalkSafe?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setEmergencyContacts((previousContacts) =>
              previousContacts.filter(
                (contact) => contact.id !== contactId
              )
            );
          },
        },
      ]
    );
  };

  // SEND EMERGENCY MESSAGE
  const sendEmergencyMessage = async () => {
    if (emergencyContacts.length === 0) {
      Alert.alert(
        "No Emergency Contacts",
        "Please add at least one emergency contact first."
      );
      return;
    }

    try {
      setSending(true);

      // Check whether SMS is available on this device
      const isAvailable = await SMS.isAvailableAsync();

      if (!isAvailable) {
        Alert.alert(
          "SMS Unavailable",
          "SMS is not available on this device."
        );
        return;
      }

      // Get phone numbers from all emergency contacts
      const phoneNumbers = emergencyContacts
        .map(
          (contact) =>
            contact.phoneNumbers?.[0]?.number
        )
        .filter(Boolean);

      if (phoneNumbers.length === 0) {
        Alert.alert(
          "No Phone Numbers",
          "None of your emergency contacts have a valid phone number."
        );
        return;
      }

      const message =
        "🚨 WALksafe EMERGENCY ALERT 🚨\n\n" +
        "I may be in danger and need help. " +
        "Please contact me as soon as possible.\n\n" +
        "This message was sent from WalkSafe.";

      // Open native SMS composer
      await SMS.sendSMSAsync(
        phoneNumbers,
        message
      );
    } catch (error) {
      console.log(
        "Emergency SMS error:",
        error
      );

      Alert.alert(
        "Error",
        "Unable to open the emergency message."
      );
    } finally {
      setSending(false);
    }
  };

  const renderEmergencyContact = ({ item }) => {
    const phoneNumber =
      item.phoneNumbers?.[0]?.number;

    return (
      <View style={styles.contactCard}>
        <View style={styles.contactLeft}>
          {/* Contact Image */}
          <View style={styles.avatar}>
            {item.imageAvailable && item.image?.uri ? (
              <Image
                source={{ uri: item.image.uri }}
                style={styles.contactImage}
              />
            ) : (
              <Text style={styles.avatarText}>
                {item.name
                  ?.charAt(0)
                  ?.toUpperCase() || "?"}
              </Text>
            )}
          </View>

          {/* Contact Information */}
          <View style={styles.contactInfo}>
            <Text style={styles.contactName}>
              {item.name || "Unknown Contact"}
            </Text>

            <Text style={styles.contactNumber}>
              {phoneNumber}
            </Text>

            <Text style={styles.emergencyLabel}>
              Emergency Contact
            </Text>
          </View>
        </View>

        {/* Remove Button */}
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() =>
            removeEmergencyContact(item.id)
          }
        >
          <Text style={styles.removeText}>
            Remove
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>
          WalkSafe
        </Text>

        <Text style={styles.subtitle}>
          Your safety, connected.
        </Text>
      </View>

      {/* Emergency Information */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>
          Emergency Contacts
        </Text>

        <Text style={styles.infoText}>
          Add people you trust. They can be
          contacted quickly when you need help.
        </Text>
      </View>

      {/* Permission Button */}
      {!permission && (
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestContactPermission}
        >
          <Text style={styles.buttonText}>
            Allow Contacts Access
          </Text>
        </TouchableOpacity>
      )}

      {/* Add Contact Button */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={addEmergencyContact}
      >
        <Text style={styles.plus}>
          +
        </Text>

        <Text style={styles.addButtonText}>
          Add Emergency Contact
        </Text>
      </TouchableOpacity>

      {/* SOS Button */}
      <TouchableOpacity
        style={[
          styles.sosButton,
          sending && styles.sosButtonDisabled,
        ]}
        onPress={sendEmergencyMessage}
        disabled={sending}
        activeOpacity={0.8}
      >
        <Text style={styles.sosIcon}>
          🚨
        </Text>

        <View>
          <Text style={styles.sosButtonText}>
            {sending
              ? "Opening Messages..."
              : "SEND SOS"}
          </Text>

          <Text style={styles.sosSubText}>
            Alert my emergency contacts
          </Text>
        </View>
      </TouchableOpacity>

      {/* Number of Contacts */}
      <Text style={styles.sectionTitle}>
        My Emergency Contacts
      </Text>

      {emergencyContacts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>
            👥
          </Text>

          <Text style={styles.emptyTitle}>
            No emergency contacts
          </Text>

          <Text style={styles.emptyText}>
            Add trusted people from your
            phone contacts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={emergencyContacts}
          keyExtractor={(item) => item.id}
          renderItem={renderEmergencyContact}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: 30,
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F9FC",
    paddingHorizontal: 20,
  },

  header: {
    paddingTop: 30,
    paddingBottom: 20,
  },

  logo: {
    fontSize: 32,
    fontWeight: "800",
    color: "#111827",
  },

  subtitle: {
    marginTop: 5,
    fontSize: 15,
    color: "#6B7280",
  },

  infoBox: {
    backgroundColor: "#FFF4F4",
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
  },

  infoTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },

  infoText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#6B7280",
  },

  permissionButton: {
    backgroundColor: "#111827",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },

  addButton: {
    backgroundColor: "#E53935",
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },

  plus: {
    color: "white",
    fontSize: 25,
    fontWeight: "500",
    marginRight: 8,
    marginTop: -2,
  },

  addButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },

  /* SOS BUTTON */
  sosButton: {
    backgroundColor: "#B91C1C",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 25,

    shadowColor: "#B91C1C",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 6,

    elevation: 4,
  },

  sosButtonDisabled: {
    opacity: 0.7,
  },

  sosIcon: {
    fontSize: 30,
    marginRight: 12,
  },

  sosButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },

  sosSubText: {
    color: "#FEE2E2",
    fontSize: 12,
    marginTop: 2,
  },

  buttonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },

  contactCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",

    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.06,
    shadowRadius: 5,

    elevation: 2,
  },

  contactLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },

  avatar: {
    height: 55,
    width: 55,
    borderRadius: 55,
    backgroundColor: "#FDECEC",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 13,
    overflow: "hidden",
  },

  contactImage: {
    height: 55,
    width: 55,
    borderRadius: 55,
  },

  avatarText: {
    fontSize: 21,
    fontWeight: "700",
    color: "#E53935",
  },

  contactInfo: {
    flex: 1,
  },

  contactName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 3,
  },

  contactNumber: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 5,
  },

  emergencyLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#E53935",
  },

  removeButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },

  removeText: {
    color: "#E53935",
    fontSize: 13,
    fontWeight: "700",
  },

  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    paddingHorizontal: 30,
  },

  emptyIcon: {
    fontSize: 45,
    marginBottom: 15,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },

  emptyText: {
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    color: "#6B7280",
  },
});