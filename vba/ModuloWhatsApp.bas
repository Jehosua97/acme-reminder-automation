Attribute VB_Name = "ModuloWhatsApp"
Option Explicit

#If VBA7 Then
    Private Declare PtrSafe Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As LongPtr)
#Else
    Private Declare Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)
#End If

' Macro para asignar al boton:
' "Enviar Todos los Recordatorios"
Public Sub EnviarRecordatorios()
    Dim carpetaProyecto As String
    Dim rutaScript As String
    Dim rutaEstado As String
    Dim rutaResultados As String
    Dim rutaLibro As String
    Dim comando As String
    Dim idProceso As Double
    Dim inicio As Date
    Dim primeraLinea As String
    Dim resumen As String
    Dim archivo As Integer
    Dim detalleError As String
    Dim filasEnviadas As Collection
    Dim confirmacion As VbMsgBoxResult

    On Error GoTo ManejarError

    If ThisWorkbook.Path = vbNullString Then
        MsgBox "Guarda primero el libro dentro de la carpeta del proyecto.", _
               vbExclamation, "Recordatorios WhatsApp"
        Exit Sub
    End If

    confirmacion = ConfirmarEnvioPendiente()
    If confirmacion = vbCancel Then Exit Sub
    If confirmacion = vbNo Then Exit Sub

    carpetaProyecto = ThisWorkbook.Path
    rutaScript = carpetaProyecto & Application.PathSeparator & "enviar.js"
    rutaEstado = carpetaProyecto & Application.PathSeparator & "estado_envio.txt"
    rutaResultados = carpetaProyecto & Application.PathSeparator & "resultados_envio.tsv"
    rutaLibro = ThisWorkbook.FullName

    If Dir$(rutaScript) = vbNullString Then
        MsgBox "No se encontro el script:" & vbCrLf & rutaScript, _
               vbCritical, "Recordatorios WhatsApp"
        Exit Sub
    End If

    ThisWorkbook.Save

    If Dir$(rutaEstado) <> vbNullString Then Kill rutaEstado
    If Dir$(rutaResultados) <> vbNullString Then Kill rutaResultados

    comando = "cmd.exe /c cd /d """ & carpetaProyecto & _
              """ && node """ & rutaScript & """ """ & rutaLibro & """"

    idProceso = Shell(comando, vbNormalFocus)

    If idProceso = 0 Then
        Err.Raise vbObjectError + 1000, , "Windows no pudo iniciar Node.js."
    End If

    inicio = Now
    Application.StatusBar = "Enviando recordatorios por WhatsApp..."

    Do While Dir$(rutaEstado) = vbNullString
        DoEvents
        Sleep 250

        If DateDiff("s", inicio, Now) > 900 Then
            Application.StatusBar = False
            MsgBox "La operacion sigue abierta despues de 15 minutos." & vbCrLf & _
                   "Revisa la ventana de Node; puede estar esperando el QR.", _
                   vbExclamation, "Recordatorios WhatsApp"
            Exit Sub
        End If
    Loop

    archivo = FreeFile
    Open rutaEstado For Input As #archivo
    Line Input #archivo, primeraLinea
    Line Input #archivo, resumen
    Close #archivo

    Set filasEnviadas = AplicarResultadosEnvio(rutaResultados)
    ThisWorkbook.Save

    If filasEnviadas.Count > 0 Then
        EsperarConCuentaRegresiva 30
        LimpiarFilasEnviadas filasEnviadas
        ThisWorkbook.Save
    End If

    Application.StatusBar = False

    If UCase$(Trim$(primeraLinea)) = "OK" Then
        MsgBox resumen, vbInformation, "Recordatorios WhatsApp"
    Else
        MsgBox resumen & vbCrLf & _
               "Revisa las columnas Estado y Notas para ver el detalle.", _
               vbExclamation, "Recordatorios WhatsApp"
    End If

    Exit Sub

ManejarError:
    detalleError = Err.Description
    On Error Resume Next
    If archivo > 0 Then Close #archivo
    Application.StatusBar = False
    MsgBox "No se pudo ejecutar el envio:" & vbCrLf & detalleError, _
           vbCritical, "Recordatorios WhatsApp"
End Sub

Private Function ConfirmarEnvioPendiente() As VbMsgBoxResult
    Dim ws As Worksheet
    Dim filaEncabezado As Long
    Dim colGrupo As Long
    Dim colTipo As Long
    Dim colEnviar As Long
    Dim colMensaje As Long
    Dim ultimaFila As Long
    Dim r As Long
    Dim total As Long
    Dim listado As String
    Dim grupo As String
    Dim tipo As String
    Dim mensaje As String
    Dim preview As String

    Set ws = ThisWorkbook.Worksheets("Recordatorios")
    filaEncabezado = EncontrarFilaEncabezado(ws)

    If filaEncabezado = 0 Then
        MsgBox "No se encontro la fila de encabezados.", _
               vbCritical, "Recordatorios WhatsApp"
        ConfirmarEnvioPendiente = vbCancel
        Exit Function
    End If

    colGrupo = BuscarColumnaCasaGrupo(ws, filaEncabezado)
    colTipo = BuscarColumnaTipoCategoria(ws, filaEncabezado)
    colEnviar = BuscarColumna(ws, filaEncabezado, "ENVIAR")
    colMensaje = BuscarColumna(ws, filaEncabezado, "MENSAJE")

    If colGrupo = 0 Or colEnviar = 0 Or colMensaje = 0 Then
        MsgBox "Faltan columnas requeridas: Casa/Grupo, Enviar o Mensaje.", _
               vbCritical, "Recordatorios WhatsApp"
        ConfirmarEnvioPendiente = vbCancel
        Exit Function
    End If

    ultimaFila = ws.Cells(ws.Rows.Count, colGrupo).End(xlUp).Row

    For r = filaEncabezado + 1 To ultimaFila
        If EsSi(ws.Cells(r, colEnviar).Value) Then
            grupo = Trim$(CStr(ws.Cells(r, colGrupo).Value))
            mensaje = Trim$(CStr(ws.Cells(r, colMensaje).Value))

            If Len(grupo) > 0 Or Len(mensaje) > 0 Then
                total = total + 1

                If colTipo > 0 Then
                    tipo = Trim$(CStr(ws.Cells(r, colTipo).Value))
                Else
                    tipo = vbNullString
                End If

                preview = Left$(mensaje, 15)
                If Len(mensaje) > 15 Then preview = preview & "..."
                If Len(preview) = 0 Then preview = "(sin mensaje)"

                listado = listado & "- " & grupo
                If Len(tipo) > 0 Then listado = listado & " [" & tipo & "]"
                listado = listado & ": " & preview & vbCrLf
            End If
        End If
    Next r

    If total = 0 Then
        MsgBox "No hay recordatorios marcados con SI.", _
               vbInformation, "Recordatorios WhatsApp"
        ConfirmarEnvioPendiente = vbCancel
        Exit Function
    End If

    ConfirmarEnvioPendiente = MsgBox( _
        "Estas por enviar mensaje a estas casas:" & vbCrLf & vbCrLf & _
        listado & vbCrLf & _
        "Total: " & total & " recordatorio(s)." & vbCrLf & vbCrLf & _
        "Quieres continuar?", _
        vbQuestion + vbYesNo + vbDefaultButton2, _
        "Confirmar envio de WhatsApp")
End Function

Private Function AplicarResultadosEnvio(ByVal rutaResultados As String) As Collection
    Dim filasEnviadas As New Collection
    Dim ws As Worksheet
    Dim filaEncabezado As Long
    Dim colEstado As Long
    Dim colNotas As Long
    Dim archivo As Integer
    Dim linea As String
    Dim partes() As String
    Dim filaExcel As Long
    Dim ok As String
    Dim estado As String
    Dim nota As String

    Set AplicarResultadosEnvio = filasEnviadas

    If Dir$(rutaResultados) = vbNullString Then Exit Function

    Set ws = ThisWorkbook.Worksheets("Recordatorios")
    filaEncabezado = EncontrarFilaEncabezado(ws)
    If filaEncabezado = 0 Then Exit Function

    colEstado = BuscarColumna(ws, filaEncabezado, "ESTADO")
    colNotas = BuscarColumna(ws, filaEncabezado, "NOTAS")

    If colEstado = 0 Or colNotas = 0 Then Exit Function

    archivo = FreeFile
    Open rutaResultados For Input As #archivo

    If Not EOF(archivo) Then Line Input #archivo, linea ' encabezado

    Do While Not EOF(archivo)
        Line Input #archivo, linea
        If Len(Trim$(linea)) > 0 Then
            partes = Split(linea, vbTab)
            If UBound(partes) >= 3 Then
                filaExcel = CLng(partes(0))
                ok = UCase$(Trim$(partes(1)))
                estado = partes(2)
                nota = partes(3)

                ws.Cells(filaExcel, colEstado).Value = estado
                ws.Cells(filaExcel, colNotas).Value = nota

                If ok = "SI" Then
                    ws.Cells(filaExcel, colEstado).Interior.Color = RGB(223, 246, 232)
                    ws.Cells(filaExcel, colEstado).Font.Color = RGB(22, 101, 52)
                    ws.Cells(filaExcel, colEstado).Font.Bold = True
                    filasEnviadas.Add filaExcel
                Else
                    ws.Cells(filaExcel, colEstado).Interior.Color = RGB(254, 226, 226)
                    ws.Cells(filaExcel, colEstado).Font.Color = RGB(153, 27, 27)
                    ws.Cells(filaExcel, colEstado).Font.Bold = True
                End If
            End If
        End If
    Loop

    Close #archivo
End Function

Private Sub LimpiarFilasEnviadas(ByVal filasEnviadas As Collection)
    Dim ws As Worksheet
    Dim filaEncabezado As Long
    Dim colEnviar As Long
    Dim colMensaje As Long
    Dim colEstado As Long
    Dim item As Variant
    Dim filaExcel As Long

    Set ws = ThisWorkbook.Worksheets("Recordatorios")
    filaEncabezado = EncontrarFilaEncabezado(ws)
    If filaEncabezado = 0 Then Exit Sub

    colEnviar = BuscarColumna(ws, filaEncabezado, "ENVIAR")
    colMensaje = BuscarColumna(ws, filaEncabezado, "MENSAJE")
    colEstado = BuscarColumna(ws, filaEncabezado, "ESTADO")

    If colEnviar = 0 Or colMensaje = 0 Or colEstado = 0 Then Exit Sub

    For Each item In filasEnviadas
        filaExcel = CLng(item)
        ws.Cells(filaExcel, colEnviar).Value = "NO"
        ws.Cells(filaExcel, colMensaje).ClearContents
        ws.Cells(filaExcel, colEstado).ClearContents
        ws.Cells(filaExcel, colEstado).Interior.Color = RGB(255, 255, 255)
        ws.Cells(filaExcel, colEstado).Font.Color = RGB(31, 41, 55)
        ws.Cells(filaExcel, colEstado).Font.Bold = False
    Next item
End Sub

Private Sub EsperarConCuentaRegresiva(ByVal segundos As Long)
    Dim restante As Long
    Dim inicio As Date

    inicio = Now

    Do
        restante = segundos - DateDiff("s", inicio, Now)
        If restante < 0 Then restante = 0
        Application.StatusBar = "Estados visibles por " & restante & _
                                " segundos. Luego se limpiaran los mensajes enviados..."
        DoEvents
        Sleep 250
    Loop While DateDiff("s", inicio, Now) < segundos
End Sub

Private Function EncontrarFilaEncabezado(ByVal ws As Worksheet) As Long
    Dim r As Long
    Dim c As Long
    Dim colEnviar As Long
    Dim colMensaje As Long
    Dim colCasaOGrupo As Long
    Dim valor As String

    For r = 1 To 30
        colEnviar = 0
        colMensaje = 0
        colCasaOGrupo = 0

        For c = 1 To 12
            valor = UCase$(QuitarAcentos(CStr(ws.Cells(r, c).Value)))
            If InStr(1, valor, "ENVIAR", vbTextCompare) > 0 Then colEnviar = c
            If InStr(1, valor, "MENSAJE", vbTextCompare) > 0 Then colMensaje = c
            If InStr(1, valor, "CASA", vbTextCompare) > 0 Or _
               InStr(1, valor, "GRUPO", vbTextCompare) > 0 Then colCasaOGrupo = c
        Next c

        If colEnviar > 0 And colMensaje > 0 And colCasaOGrupo > 0 And _
           colEnviar <> colMensaje And colEnviar <> colCasaOGrupo And _
           colMensaje <> colCasaOGrupo Then
            EncontrarFilaEncabezado = r
            Exit Function
        End If
    Next r
End Function

Private Function BuscarColumna(ByVal ws As Worksheet, ByVal filaEncabezado As Long, ByVal textoBuscado As String) As Long
    Dim c As Long
    Dim valor As String

    For c = 1 To 20
        valor = UCase$(QuitarAcentos(CStr(ws.Cells(filaEncabezado, c).Value)))
        If InStr(1, valor, textoBuscado, vbTextCompare) > 0 Then
            BuscarColumna = c
            Exit Function
        End If
    Next c
End Function

Private Function BuscarColumnaCasaGrupo(ByVal ws As Worksheet, ByVal filaEncabezado As Long) As Long
    Dim c As Long
    Dim valor As String

    For c = 1 To 20
        valor = UCase$(QuitarAcentos(CStr(ws.Cells(filaEncabezado, c).Value)))
        If InStr(1, valor, "CASA", vbTextCompare) > 0 Or _
           InStr(1, valor, "GRUPO", vbTextCompare) > 0 Then
            BuscarColumnaCasaGrupo = c
            Exit Function
        End If
    Next c
End Function

Private Function BuscarColumnaTipoCategoria(ByVal ws As Worksheet, ByVal filaEncabezado As Long) As Long
    Dim c As Long
    Dim valor As String

    For c = 1 To 20
        valor = UCase$(QuitarAcentos(CStr(ws.Cells(filaEncabezado, c).Value)))
        If InStr(1, valor, "TIPO", vbTextCompare) > 0 Or _
           InStr(1, valor, "CATEGORIA", vbTextCompare) > 0 Then
            BuscarColumnaTipoCategoria = c
            Exit Function
        End If
    Next c
End Function

Private Function EsSi(ByVal valor As Variant) As Boolean
    Dim textoValor As String
    textoValor = UCase$(QuitarAcentos(Trim$(CStr(valor))))
    EsSi = (textoValor = "SI")
End Function

Private Function QuitarAcentos(ByVal texto As String) As String
    texto = Replace(texto, "Á", "A")
    texto = Replace(texto, "É", "E")
    texto = Replace(texto, "Í", "I")
    texto = Replace(texto, "Ó", "O")
    texto = Replace(texto, "Ú", "U")
    texto = Replace(texto, "á", "a")
    texto = Replace(texto, "é", "e")
    texto = Replace(texto, "í", "i")
    texto = Replace(texto, "ó", "o")
    texto = Replace(texto, "ú", "u")
    QuitarAcentos = texto
End Function
