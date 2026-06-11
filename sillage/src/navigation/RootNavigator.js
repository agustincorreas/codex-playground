import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DescubriScreen from '../screens/DescubriScreen';
import WizardScreen from '../screens/WizardScreen';
import ProcesandoScreen from '../screens/ProcesandoScreen';
import ResultadosScreen from '../screens/ResultadosScreen';
import PaywallScreen from '../screens/PaywallScreen';
import SommelierScreen from '../screens/SommelierScreen';
import HistorialScreen from '../screens/HistorialScreen';
import GuardadosScreen from '../screens/GuardadosScreen';
import PerfilScreen from '../screens/PerfilScreen';
import { colors } from '../theme/tokens';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const tema = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.fondo,
    card: colors.superficie,
    border: colors.separador,
    text: colors.texto,
    primary: colors.acento,
  },
};

const opcionesStack = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.fondo },
};

function DescubriStack() {
  return (
    <Stack.Navigator screenOptions={opcionesStack}>
      <Stack.Screen name="Descubri" component={DescubriScreen} />
      <Stack.Screen name="Wizard" component={WizardScreen} />
      <Stack.Screen name="Procesando" component={ProcesandoScreen} options={{ gestureEnabled: false }} />
      <Stack.Screen name="Resultados" component={ResultadosScreen} />
      <Stack.Screen
        name="Sommelier"
        component={SommelierScreen}
        options={{ headerShown: true, title: 'Sommelier' }}
      />
      <Stack.Screen
        name="Paywall"
        component={PaywallScreen}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}

const ICONOS_TAB = {
  DescubriStack: '◈',   // brújula
  Historial: '◷',       // reloj
  Guardados: '⚑',       // marcador
  Perfil: '◉',          // persona
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={tema}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.superficie,
            borderTopColor: colors.separador,
          },
          tabBarActiveTintColor: colors.acento,
          tabBarInactiveTintColor: colors.textoSecundario,
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>{ICONOS_TAB[route.name]}</Text>
          ),
        })}
      >
        <Tab.Screen
          name="DescubriStack"
          component={DescubriStack}
          options={{ title: 'Descubrí' }}
        />
        <Tab.Screen name="Historial" component={HistorialScreen} />
        <Tab.Screen name="Guardados" component={GuardadosScreen} />
        <Tab.Screen
          name="Perfil"
          component={PerfilScreen}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
